/**
 * `deploy/deploy.sh` ni sinaydi: `bun run check:deploy`
 *
 * Skript serverni o'zgartiradi (paketlar, systemd, foydalanuvchi), shuning uchun
 * bu yerda **haqiqiy** `deploy.sh` olinadi va faqat yo'llar hamda tizim
 * buyruqlari almashtiriladi: hamma narsa `/tmp/daftar-deploy-check` ichida
 * bajariladi, `apt-get`, `dpkg`, `systemctl`, `useradd`, `curl`, `runuser` va
 * `bun` o'rniga kichik stub'lar qo'yiladi. Git esa haqiqiy — repozitoriy
 * vazifasini `/tmp` dagi lokal repo bajaradi (`file://` manzil).
 *
 * Tekshiriladi:
 *   1. birinchi ishga tushirishda loyiha `git clone` qilinadi va `.env` namuna
 *      sifatida yaratiladi;
 *   2. ilgari `rsync` bilan joylashtirilgan papkada `.env` (bot tokeni) bor
 *      bo'lsa, `git clone` uni O'CHIRMAYDI (haqiqiy xato shu edi);
 *   3. keyingi ishga tushirishlar `git pull` qiladi va yangi commitlarni oladi;
 *   4. skript o'rnatilgan papkaning o'zidan ishga tushirilsa, o'z-o'zini
 *      o'chirib qo'ymaydi (xavfsiz nusxadan davom etadi);
 *   5. serverda ish paytida kuzatilgan fayl o'zgarib qolgan bo'lsa (masalan
 *      `bun install` `bun.lock` ni yangilasa) va yangilanish ham o'sha faylga
 *      tegsa, oddiy `git pull` merjni rad etadi — skript serverdagi
 *      o'zgarishlarni zaxiraga olib, yangilanishni baribir o'rnatadi va
 *      `.env` ni saqlab qoladi;
 *   6. kelayotgan versiya papkada allaqachon mavjud kuzatilmaydigan fayl
 *      qo'shmoqchi bo'lsa ham shu ish qilinadi: eski fayl jimgina o'chirilmaydi,
 *      zaxira papkasiga ko'chiriladi;
 *   7. har bir to'liq deploy saytni qayta yig'adi (`dist/`), nginx ni qayta
 *      o'qitadi va avtomatik yangilash taymerini o'rnatib yoqadi;
 *   8. `autodeploy.sh` o'zgarish bo'lmasa hech narsa qilmaydi, yangi commit
 *      bo'lsa to'liq deploy'ni o'zi bajaradi (`.env` ham saqlanadi),
 *      `--check` esa faqat aytib qo'yadi, `git fetch` yiqilsa tinch turadi;
 *   9. papka boshqa foydalanuvchiga tegishli bo'lsa ham root shu papkada git
 *      ishlata oladi: `deploy.sh` papkani `safe.directory` ga bir marta
 *      (takrorlamasdan) qo'shadi — aks holda git "detected dubious ownership"
 *      xatosi bilan to'xtaydi (foydalanuvchi shu xatoga uchragan edi);
 *  10. `.github/workflows/deploy.yml` (push → SSH → deploy) to'g'ri tuzilgan:
 *      `main` push'ida ishga tushadi, tashqi action ishlatmaydi, kerakli maxfiy
 *      qiymatlarni ishlatadi va qo'llanmadagi (`deploy/README.md`) buyruq hamda
 *      sudo qoidasiga aynan mos keladi — ular bir xil bo'lmasa, GitHub'dagi
 *      deploy jimgina yiqilardi. Sudo qoidasining sintaksisi `visudo -cf` bilan
 *      tekshiriladi.
 * Skript root huquqini talab qiladi (deploy.sh ning o'zi ham): root bo'lmasa
 * tekshiruv bajarilmaydi va buni ochiq aytib, xato bilan tugaydi.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));
const REAL_SCRIPT = join(REPO_DIR, "deploy/deploy.sh");
const REAL_UNIT = join(REPO_DIR, "deploy/daftar-bot.service");
const REAL_AUTODEPLOY = join(REPO_DIR, "deploy/autodeploy.sh");
const REAL_AUTODEPLOY_SERVICE = join(REPO_DIR, "deploy/daftar-autodeploy.service");
const REAL_AUTODEPLOY_TIMER = join(REPO_DIR, "deploy/daftar-autodeploy.timer");
const REAL_WORKFLOW = join(REPO_DIR, ".github/workflows/deploy.yml");
const DEPLOY_GUIDE = join(REPO_DIR, "deploy/README.md");
const ROOT_README = join(REPO_DIR, "Readme.md");

const WORK = "/tmp/daftar-deploy-check";
const APP = `${WORK}/app`;
const DATA = `${WORK}/data`;
const UNITS = `${WORK}/units`;
const BIN = `${WORK}/bin`;
const SCRIPT_DIR = `${WORK}/script`;
const REMOTE = `${WORK}/remote`;
const REMOTE_URL = `file://${REMOTE}`;
const SYSTEMCTL_LOG = `${WORK}/systemctl.log`;

const OWNER = "root";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

function fail(message: string): never {
  console.error(`\nTEKSHIRUV YIQILDI: ${message}`);
  process.exit(1);
}

/** Tizim buyruqlarini almashtiruvchi stub yozadi. */
async function stub(name: string, body: string): Promise<void> {
  const file = join(BIN, name);
  await writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
  chmodSync(file, 0o755);
}

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", ["-c", "user.email=check@example.com", "-c", "user.name=check", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`git ${args.join(" ")} bajarilmadi: ${result.stderr}`);
  return result.stdout;
}

interface RunResult {
  status: number;
  output: string;
}

/** Sinov skriptini stub muhitida ishga tushiradi. */
function run(
  scriptPath: string,
  args: string[] = [],
  cwd = WORK,
  extraEnv: Record<string, string> = {},
): RunResult {
  const result = spawnSync("bash", [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH ?? ""}`, HOME: `${WORK}/home`, ...extraEnv },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  console.log(
    `\n$ bash ${scriptPath.replace(WORK, "WORK")} ${args.join(" ")}  →  ${result.status}\n` +
      output
        .trim()
        .split("\n")
        .slice(-6)
        .map((line) => `    | ${line}`)
        .join("\n"),
  );
  return { status: result.status ?? -1, output };
}

/** `.env` dagi token (env faylini tekshiruvchi yordamchi). */
function tokenInEnv(): string {
  const text = existsSync(`${APP}/.env`) ? readFileSync(`${APP}/.env`, "utf8") : "";
  return /^TELEGRAM_BOT_TOKEN=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
}

/** Stub `systemctl` ga yozilgan chaqiruvlar. */
function systemctlCalls(): string {
  return existsSync(SYSTEMCTL_LOG) ? readFileSync(SYSTEMCTL_LOG, "utf8") : "";
}

async function main(): Promise<void> {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    fail("bu tekshiruv root huquqini talab qiladi (deploy.sh ham root ostida ishlaydi).");
  }

  await rm(WORK, { recursive: true, force: true });
  await mkdir(BIN, { recursive: true });
  await mkdir(UNITS, { recursive: true });
  await mkdir(SCRIPT_DIR, { recursive: true });
  await mkdir(`${WORK}/home`, { recursive: true });
  await mkdir(REMOTE, { recursive: true });

  // ---- stub buyruqlar -----------------------------------------------------
  await stub("bun", '[ "$1" = "--version" ] && { echo "1.0.0-check"; exit 0; }\nexit 0');
  await stub("dpkg", "exit 0");
  await stub("apt-get", "exit 0");
  await stub("curl", "exit 0");
  await stub("useradd", "exit 0");
  await stub("systemctl", `printf '%s\\n' "systemctl $*" >> "${SYSTEMCTL_LOG}"\nexit 0`);
  // runuser -u USER [--] BUYRUQ... → buyruqni to'g'ridan-to'g'ri ishga tushiramiz.
  await stub(
    "runuser",
    'while [ $# -gt 0 ]; do\n  case "$1" in\n    -u) shift 2 ;;\n    --) shift; break ;;\n    *) break ;;\n  esac\ndone\nexec "$@"',
  );

  // ---- haqiqiy skriptlarni yo'llari almashtirilgan holda nusxalash --------
  // Serverdagi yo'llar (/opt, /var/lib, /etc/systemd/system, /usr/local/bin)
  // shu sandbox ichidagi yo'llarga almashtiriladi — skript hech qachon tashqariga
  // yozmaydi.
  const adapt = (text: string): string =>
    text
      .split("/opt/daftar-bot")
      .join(APP)
      .split("/var/lib/daftar-bot")
      .join(DATA)
      .split("/etc/systemd/system")
      .join(UNITS)
      .split("/usr/local/bin/bun")
      .join(`${BIN}/bun`)
      .split("${HOME}/.bun/bin/bun")
      .join(`${BIN}/bun`)
      .split("daftar:daftar")
      .join(`${OWNER}:${OWNER}`)
      .split("-u daftar")
      .join(`-u ${OWNER}`);

  const original = await readFile(REAL_SCRIPT, "utf8");
  const adapted = adapt(original);
  if (adapted === original) fail("deploy.sh da kutilgan yo'llar topilmadi — testni moslashtirish kerak.");
  const scriptPath = `${SCRIPT_DIR}/deploy.sh`;
  await writeFile(scriptPath, adapted, "utf8");
  await copyFile(REAL_UNIT, `${SCRIPT_DIR}/daftar-bot.service`);
  await copyFile(REAL_AUTODEPLOY_SERVICE, `${SCRIPT_DIR}/daftar-autodeploy.service`);
  await copyFile(REAL_AUTODEPLOY_TIMER, `${SCRIPT_DIR}/daftar-autodeploy.timer`);

  // Avtomatik yangilash skripti ham xuddi shunday moslashtiriladi. Muhim:
  // repozitoriyga ham MOSLASHTIRILGAN nusxa yoziladi — serverda deploy'ni
  // takroran chaqiradigan skript sandbox ichida qolishi shart.
  const autodeployOriginal = await readFile(REAL_AUTODEPLOY, "utf8");
  const autodeploy = adapt(autodeployOriginal);
  if (autodeploy === autodeployOriginal) fail("autodeploy.sh da kutilgan yo'llar topilmadi — testni moslashtirish kerak.");
  const autodeployPath = `${SCRIPT_DIR}/autodeploy.sh`;
  await writeFile(autodeployPath, autodeploy, "utf8");

  // ---- lokal repozitoriy (git manbasi) ------------------------------------
  await mkdir(join(REMOTE, "bot"), { recursive: true });
  await mkdir(join(REMOTE, "deploy"), { recursive: true });
  await writeFile(join(REMOTE, "bot/index.ts"), "// 1-versiya\nconsole.log(\"v1\");\n", "utf8");
  await writeFile(
    join(REMOTE, "package.json"),
    '{\n  "name": "daftar-bot-check",\n  "scripts": {\n    "build": "vite build"\n  }\n}\n',
    "utf8",
  );
  await writeFile(join(REMOTE, "Readme.md"), "# Sinov repozitoriyasi\n", "utf8");
  // Repozitoriyga sandbox uchun moslashtirilgan skriptlar yoziladi (ya'ni
  // sandbox ichida klonlanadigan nusxa ham xavfsiz qoladi).
  await writeFile(join(REMOTE, "deploy/deploy.sh"), adapted, "utf8");
  await writeFile(join(REMOTE, "deploy/autodeploy.sh"), autodeploy, "utf8");
  await copyFile(REAL_UNIT, join(REMOTE, "deploy/daftar-bot.service"));
  await copyFile(REAL_AUTODEPLOY_SERVICE, join(REMOTE, "deploy/daftar-autodeploy.service"));
  await copyFile(REAL_AUTODEPLOY_TIMER, join(REMOTE, "deploy/daftar-autodeploy.timer"));
  git(["init", "-q", "-b", "main", "."], REMOTE);
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v1"], REMOTE);

  console.log("=== 1-holat: birinchi o'rnatish (git clone) ===");
  const first = run(scriptPath, [REMOTE_URL]);
  assert(first.status === 0, `skript xatosiz tugadi (kod ${first.status})`);
  assert(existsSync(`${APP}/bot/index.ts`), "loyiha fayllari joylashtirildi");
  assert(existsSync(`${APP}/.git`), "papka git repozitoriyga aylandi");
  assert(existsSync(`${APP}/.env`), ".env namuna sifatida yaratildi");
  assert(existsSync(DATA), `ma'lumot papkasi yaratildi (${DATA.replace(WORK, "WORK")})`);
  assert(existsSync(`${UNITS}/daftar-bot.service`), "systemd unit fayli o'rnatildi");
  assert(systemctlCalls().includes("restart daftar-bot"), "xizmat qayta ishga tushirildi");
  assert(first.output.includes("Sayt yig'ilmoqda"), "deploy saytni ham yig'adi (dist)");
  assert(systemctlCalls().includes("reload nginx"), "nginx qayta o'qitildi");
  assert(
    existsSync(`${UNITS}/daftar-autodeploy.timer`),
    "avtomatik yangilash taymeri o'rnatildi",
  );
  assert(
    systemctlCalls().includes("enable --now daftar-autodeploy.timer"),
    "taymer o'rnatildi va yoqildi",
  );

  console.log("\n=== 2-holat: rsync bilan o'rnatilgan nusxa + mavjud token ===");
  const token = "111222:CHECK-TOKEN-KEEP-ME";
  const envText = (await readFile(`${APP}/.env`, "utf8")).replace(/^TELEGRAM_BOT_TOKEN=.*$/m, `TELEGRAM_BOT_TOKEN=${token}`);
  await writeFile(`${APP}/.env`, envText, "utf8");
  // rsync bilan ko'chirilgan nusxada .git bo'lmaydi — shu holatni tiklaymiz.
  await rm(`${APP}/.git`, { recursive: true, force: true });
  const second = run(scriptPath, [REMOTE_URL]);
  assert(second.status === 0, `skript xatosiz tugadi (kod ${second.status})`);
  assert(existsSync(`${APP}/.git`), "papka yana git repozitoriy bo'ldi");
  assert(tokenInEnv() === token, "mavjud .env saqlanib qoldi (bot tokeni o'chmadi)");

  console.log("\n=== 3-holat: keyingi ishga tushirish — git pull ===");
  const third = run(scriptPath, [REMOTE_URL]);
  assert(third.status === 0, `skript xatosiz tugadi (kod ${third.status})`);
  assert(third.output.includes("git pull"), "yangilash git pull orqali bo'ldi");
  assert(tokenInEnv() === token, "token hamon joyida");

  console.log("\n=== 4-holat: repozitoriyga yangi commit qo'shildi ===");
  await writeFile(join(REMOTE, "bot/index.ts"), "// 2-versiya\nconsole.log(\"v2\");\n", "utf8");
  await writeFile(join(REMOTE, "yangi-fayl.txt"), "yangi\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v2"], REMOTE);
  const fourth = run(scriptPath, [REMOTE_URL]);
  assert(fourth.status === 0, `skript xatosiz tugadi (kod ${fourth.status})`);
  assert(existsSync(`${APP}/yangi-fayl.txt`), "yangi commit fayllari serverga tushdi");
  assert(
    (await readFile(`${APP}/bot/index.ts`, "utf8")).includes("2-versiya"),
    "mavjud fayl yangi versiyaga yangilandi",
  );

  console.log("\n=== 5-holat: skript o'rnatilgan papkaning o'zidan ishga tushirildi ===");
  await writeFile(join(REMOTE, "uchinchi-fayl.txt"), "uchinchi\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v3"], REMOTE);
  await mkdir(`${APP}/deploy`, { recursive: true });
  await copyFile(scriptPath, `${APP}/deploy/deploy.sh`);
  await copyFile(REAL_UNIT, `${APP}/deploy/daftar-bot.service`);
  const fifth = run(`${APP}/deploy/deploy.sh`, [REMOTE_URL], APP);
  assert(fifth.status === 0, `skript xatosiz tugadi (kod ${fifth.status})`);
  assert(fifth.output.includes("xavfsiz nusxadan qayta ishga tushiriladi"), "o'zini o'chirishdan himoya ishladi");
  assert(existsSync(`${APP}/uchinchi-fayl.txt`), "papka tozalanib, yangi versiya o'rnatildi");
  assert(tokenInEnv() === token, "bu holatda ham token saqlanib qoldi");

  console.log("\n=== 6-holat: serverda o'zgargan kuzatilgan fayl (git pull to'sqinlik qiladi) ===");
  // Haqiqiy serverda `bun install` kuzatilgan faylni (masalan `bun.lock`) o'zgartirib
  // qo'yishi mumkin; kelayotgan commit ham o'sha faylga tegadi. Bunday holatda oddiy
  // `git pull` "Your local changes would be overwritten" xatosi bilan to'xtaydi —
  // skript kuzatilgan fayllarni tiklab, yangilanishni baribir o'rnatishi kerak.
  await writeFile(join(REMOTE, "Readme.md"), "# Sinov repozitoriyasi\n\nyangilangan\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v4-readme"], REMOTE);
  await writeFile(`${APP}/Readme.md`, "# serverda qo'lda o'zgargan\n", "utf8");
  const sixth = run(scriptPath, [REMOTE_URL]);
  assert(sixth.status === 0, `skript xatosiz tugadi (kod ${sixth.status})`);
  assert(
    sixth.output.includes("serverdagi o'zgarishlar"),
    "kuzatilgan fayl zaxiralanib, pull qaytarildi",
  );
  assert(
    (await readFile(`${APP}/Readme.md`, "utf8")).includes("yangilangan"),
    "o'zgargan kuzatilgan fayl yangi versiyaga yangilandi",
  );
  assert(tokenInEnv() === token, "bu holatda ham token saqlandi");

  console.log("\n=== 7-holat: kelayotgan versiya papkada mavjud kuzatilmaydigan fayl qo'shadi ===");
  // Haqiqiy serverda aynan shu holat bo'ldi: papkada qo'lda yaratilgan
  // `pdf.ts` kabi fayllar turgan, keyingi commit esa o'sha nom bilan kelgan.
  // `git pull` bunday fayllar ustidan yozishdan bosh tortadi — skript ularni
  // zaxiraga ko'chirib, yangilanishni davom ettirishi kerak.
  await writeFile(join(REMOTE, "kuzatilmaydigan-yangi.ts"), "repo versiyasi\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v5-kuzatilmaydigan"], REMOTE);
  await writeFile(`${APP}/kuzatilmaydigan-yangi.ts`, "serverdagi nusxa\n", "utf8");
  await writeFile(`${APP}/Readme.md`, "# yana qo'lda o'zgargan\n", "utf8");
  const seventh = run(scriptPath, [REMOTE_URL]);
  assert(seventh.status === 0, `skript xatosiz tugadi (kod ${seventh.status})`);
  assert(seventh.output.includes("eski holat saqlandi"), "zaxira haqida xabar berildi");
  assert(
    (await readFile(`${APP}/kuzatilmaydigan-yangi.ts`, "utf8")).includes("repo versiyasi"),
    "kuzatilmaydigan fayl yangi versiya bilan almashtirildi",
  );
  const backups = readdirSync(DATA).filter((name) => name.startsWith("deploy-backup-")).sort();
  assert(backups.length > 0, `zaxira papkasi yaratildi (${backups.join(", ")})`);
  const lastBackup = backups.length > 0 ? join(DATA, backups[backups.length - 1]!) : "";
  const savedFile = join(lastBackup, "untracked/kuzatilmaydigan-yangi.ts");
  assert(
    lastBackup !== "" && existsSync(savedFile) && readFileSync(savedFile, "utf8").includes("serverdagi nusxa"),
    "eski fayl zaxira papkasida saqlanib qoldi",
  );
  assert(lastBackup !== "" && existsSync(join(lastBackup, "changes.patch")), "kuzatilgan o'zgarishlar patchi ham saqlandi");
  assert(tokenInEnv() === token, "bu holatda ham token saqlandi");

  // ---- avtomatik yangilash (autodeploy.sh + taymer) ----------------------
  // Taymer har 2 daqiqada shu skriptni chaqiradi: u yangi commit bo'lsa to'liq
  // deploy'ni o'zi bajarishi, bo'lmasa esa hech narsaga tegmasligi kerak.
  const autoEnv = { AUTODEPLOY_LOCK: `${WORK}/autodeploy.lock` };
  const restartsNow = () => (systemctlCalls().match(/restart daftar-bot/g) ?? []).length;

  console.log("\n=== 8-holat: autodeploy — o'zgarish bo'lmasa hech narsa qilmaydi ===");
  const restartsBefore = restartsNow();
  const quiet = run(autodeployPath, ["--verbose"], WORK, autoEnv);
  assert(quiet.status === 0, `tekshiruv xatosiz tugadi (kod ${quiet.status})`);
  assert(quiet.output.includes("o'zgarish yo'q"), "o'zgarish yo'qligi aytildi");
  assert(
    restartsNow() === restartsBefore,
    "o'zgarish bo'lmasa bot qayta ishga tushirilmadi (build ham qilinmadi)",
  );

  console.log("\n=== 9-holat: autodeploy — yangi commit'ni o'zi o'rnatadi ===");
  await writeFile(join(REMOTE, "bot/index.ts"), "// 3-versiya\nconsole.log(\"v3\");\n", "utf8");
  await writeFile(join(REMOTE, "avtomatik-fayl.txt"), "avtomatik\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v6-avtomatik-yangilash"], REMOTE);
  const auto = run(autodeployPath, [], WORK, autoEnv);
  assert(auto.status === 0, `autodeploy xatosiz tugadi (kod ${auto.status})`);
  assert(/\d+ ta yangi commit topildi/.test(auto.output), "yangi commit topilgani aytildi");
  assert(auto.output.includes("v6-avtomatik-yangilash"), "commit sarlavhasi jurnalga chiqdi");
  assert(auto.output.includes("Yangilandi (git pull)"), "to'liq deploy bajarildi (git pull)");
  assert(auto.output.includes("Sayt yig'ilmoqda"), "sayt qayta yig'ildi (dist)");
  assert(auto.output.includes("nginx qayta o'qitildi"), "nginx qayta o'qitildi");
  assert(
    (await readFile(`${APP}/bot/index.ts`, "utf8")).includes("3-versiya"),
    "yangi commit serverga o'rnatildi",
  );
  assert(existsSync(`${APP}/avtomatik-fayl.txt`), "kelgan commitning yangi fayli ham joyida");
  assert(restartsNow() > restartsBefore, "bot avtomatik qayta ishga tushirildi");
  assert(tokenInEnv() === token, "avtomatik deploy ham .env ni saqlab qoldi");
  assert(auto.output.includes("tayyor:"), "natija jurnalga yozildi (tayyor)");

  console.log("\n=== 10-holat: autodeploy --check — bor-yo'qini aytadi, o'rnatmaydi ===");
  await writeFile(join(REMOTE, "tekshiruv-fayl.txt"), "tekshiruv\n", "utf8");
  git(["add", "-A"], REMOTE);
  git(["commit", "-q", "-m", "v7-check"], REMOTE);
  const restartsBeforeCheck = restartsNow();
  const checkOnly = run(autodeployPath, ["--check"], WORK, autoEnv);
  assert(checkOnly.status === 0, `--check xatosiz tugadi (kod ${checkOnly.status})`);
  assert(checkOnly.output.includes("ta yangi commit topildi"), "--check yangilanish borligini ko'rsatdi");
  assert(checkOnly.output.includes("--check: faqat tekshirildi"), "deploy qilinmagani aytildi");
  assert(!existsSync(`${APP}/tekshiruv-fayl.txt`), "--check hech narsa o'rnatmadi");
  assert(restartsNow() === restartsBeforeCheck, "--check botni qayta ishga tushirmadi");

  console.log("\n=== 11-holat: root boshqa foydalanuvchining papkasida git ishlatadi ===");
  // Haqiqiy serverda shu xato chiqqan edi:
  //   fatal: detected dubious ownership in repository at '/opt/daftar-bot'
  // Papka `daftar` foydalanuvchisiga tegishli, root esa u yerda `git pull`
  // yozgan. `deploy.sh` bunday papkani root uchun "xavfsiz" deb belgilashi kerak.
  const gitHome = `${WORK}/home`;
  const bareHome = `${WORK}/bosh-uy`;
  await mkdir(bareHome, { recursive: true });
  const globalConfig = `${gitHome}/.gitconfig`;
  assert(
    existsSync(globalConfig) && readFileSync(globalConfig, "utf8").includes(`directory = ${APP}`),
    `deploy.sh papkani root uchun xavfsiz deb belgiladi (${APP.replace(WORK, "WORK")})`,
  );
  const entries = readFileSync(globalConfig, "utf8")
    .split("\n")
    .filter((line) => line.trim() === `directory = ${APP}`).length;
  assert(entries === 1, `yozuv takrorlanmadi — bir marta qo'shilgan (${entries} ta)`);

  // Papkani boshqa foydalanuvchiga o'tkazamiz (begona egalik holatini tiklaymiz).
  chownSync(APP, 65534, 65534);
  const gitIn = (home: string, extraEnv: Record<string, string> = {}) =>
    spawnSync("git", ["-C", APP, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, ...extraEnv },
    });
  // Tizim sozlamasidagi `safe.directory = *` (konteynerlarda bo'ladi) tekshiruvni
  // bekor qilmasligi uchun u o'chiriladi — serverdagi holat aynan shunday.
  const withoutConfig = gitIn(bareHome, { GIT_CONFIG_NOSYSTEM: "1" });
  assert(
    withoutConfig.status !== 0 && (withoutConfig.stderr ?? "").includes("dubious ownership"),
    "begona egalik aniqlandi (sozlamasiz git to'xtaydi — foydalanuvchi xatosi)",
  );
  const withConfig = gitIn(gitHome, { GIT_CONFIG_NOSYSTEM: "1" });
  assert(
    withConfig.status === 0 && (withConfig.stdout ?? "").trim().length > 0,
    "deploy.sh yozgan sozlama bilan root papkada git ishlatadi",
  );
  chownSync(APP, 0, 0);

  console.log("\n=== 12-holat: autodeploy — fetch yiqilsa tinch turadi ===");
  const goodOrigin = spawnSync("git", ["-C", APP, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).stdout.trim();
  git(["remote", "set-url", "origin", `file://${WORK}/yoq-repozitoriy`], APP);
  const restartsBeforeBroken = restartsNow();
  const broken = run(autodeployPath, [], WORK, autoEnv);
  assert(broken.status === 0, `tarmoq xatosi skriptni yiqitmadi (kod ${broken.status})`);
  assert(
    broken.output.includes("git fetch bajarilmadi"),
    "fetch xatosi ogohlantirish bilan aytildi",
  );
  assert(restartsNow() === restartsBeforeBroken, "fetch yiqilganda hech narsa o'rnatilmadi");
  git(["remote", "set-url", "origin", goodOrigin], APP);

  // ---- GitHub Actions: push → SSH → deploy --------------------------------
  // Push bo'lishi bilan o'rnatadigan ikkinchi yo'l: `.github/workflows/deploy.yml`
  // runnerdan serverga SSH bilan kirib, xuddi taymer chaqiradigan skriptni ishga
  // tushiradi. Shu sababli ish oqimining tuzilishi va u bilan qo'llanma
  // (`deploy/README.md`) o'rtasidagi moslik tekshiriladi: SSH orqali yuboriladigan
  // buyruq hamda sudo qoidasi bir xil bo'lmasa, GitHub'dagi deploy jimgina yiqilardi.
  interface BunYamlHost {
    Bun?: { YAML?: { parse?: (input: string) => unknown } };
  }
  const parseYaml = (globalThis as BunYamlHost).Bun?.YAML?.parse;

  console.log("\n=== 13-holat: GitHub Actions ish oqimi (push → SSH → deploy) ===");
  assert(
    existsSync(REAL_WORKFLOW),
    `ish oqimi fayli mavjud (${REAL_WORKFLOW.replace(REPO_DIR, "")})`,
  );
  assert(typeof parseYaml === "function", "YAML parseri mavjud (skriptlar `bun` bilan ishga tushadi)");
  const workflowText = existsSync(REAL_WORKFLOW) ? await readFile(REAL_WORKFLOW, "utf8") : "";
  const parsed = typeof parseYaml === "function" ? parseYaml(workflowText) : null;
  assert(parsed !== null && typeof parsed === "object", "ish oqimi YAML sifatida o'qildi (sintaksis to'g'ri)");

  const workflow = (parsed ?? {}) as {
    on?: Record<string, unknown>;
    jobs?: Record<string, { "runs-on"?: string; steps?: { uses?: string; run?: string }[] }>;
  };
  const triggers = workflow.on ?? {};
  const branches = (triggers.push as { branches?: string[] } | undefined)?.branches ?? [];
  assert(branches.includes("main"), "faqat `main` shoxiga push bo'lganda ishga tushadi");
  assert("workflow_dispatch" in triggers, "qo'lda ishga tushirish ham mumkin (workflow_dispatch)");

  const job = workflow.jobs?.deploy;
  assert(job !== undefined, "`deploy` jobi mavjud");
  assert(job?.["runs-on"] === "ubuntu-latest", "job GitHub runnerida ishlaydi (ubuntu-latest)");
  const steps = job?.steps ?? [];
  assert(steps.length >= 2, `kalit tayyorlash va deploy qadamlari bor (${steps.length} qadam)`);
  assert(
    steps.every((step) => typeof step.uses !== "string"),
    "tashqi action ishlatilmaydi (faqat ssh/ssh-keyscan)",
  );
  assert(
    ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_SSH_KEY"].every((key) =>
      workflowText.includes(`secrets.${key}`),
    ),
    "kerakli maxfiy qiymatlar ishlatiladi (DEPLOY_HOST, DEPLOY_USER, DEPLOY_SSH_KEY)",
  );

  const deployCommand = "sudo -n /bin/bash /opt/daftar-bot/deploy/autodeploy.sh";
  assert(
    workflowText.includes(deployCommand),
    "SSH orqali xuddi taymer chaqiradigan skript ishga tushiriladi",
  );
  const guide = await readFile(DEPLOY_GUIDE, "utf8");
  assert(guide.includes(deployCommand), "qo'llanmada ham aynan shu buyruq yozilgan");
  const sudoersLine = "daftar ALL=(root) NOPASSWD: /bin/bash /opt/daftar-bot/deploy/autodeploy.sh";
  assert(
    guide.includes(sudoersLine),
    "qo'llanmada `daftar` ga faqat shu skriptni ruxsat qiluvchi sudo qoidasi bor",
  );
  // `daftar` — system foydalanuvchi: deploy.sh uni `nologin` qobiq bilan yaratadi,
  // shuning uchun hujjat unga login qobig'i berishni aytishi shart — aks holda
  // GitHub runnerining SSH urinishi "This account is currently not available" bilan yiqiladi.
  assert(
    guide.includes("sudo usermod -s /bin/bash daftar"),
    "qo'llanmada `daftar` ga login qobig'i berilishi yozilgan (nologin bilan SSH ishlamaydi)",
  );
  const installer = await readFile(join(REPO_DIR, "deploy/deploy.sh"), "utf8");
  assert(
    installer.includes("--shell /usr/sbin/nologin"),
    "o'rnatish skripti `daftar` ni baribir nologin bilan yaratadi (qo'llanma shuni to'g'rilaydi)",
  );
  assert(
    guide.includes("/home/daftar/.ssh/github-actions.pub"),
    "qo'llanmadagi kalit yo'llari to'liq yozilgan (HOME'ga bog'liq bo'lmasin)",
  );
  assert(
    (await readFile(ROOT_README, "utf8")).includes(".github/workflows/deploy.yml"),
    "asosiy Readme'dan ish oqimiga ishora bor",
  );

  // Sudo qoidasi matni haqiqatan to'g'ri sintaksis ekanini sudo'ning o'zi aytadi.
  const sudoersFile = `${WORK}/daftar-sudoers`;
  await writeFile(sudoersFile, `${sudoersLine}\n`, "utf8");
  chmodSync(sudoersFile, 0o440);
  const visudo = spawnSync("visudo", ["-cf", sudoersFile], { encoding: "utf8" });
  const visudoError = visudo.error?.message ?? "";
  assert(
    visudo.status === 0,
    `sudo qoidasi sintaksisi to'g'ri (visudo -cf${visudoError ? `: ${visudoError}` : ""})`,
  );

  if (failures > 0) {
    console.error(`\nDEPLOY TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log(
    "\nDeploy tekshiruvi o'tdi: clone → .env saqlanishi → pull → yangilanish → " +
      "xavfsiz qayta ishga tushish → serverdagi o'zgarishlarni zaxiralash → " +
      "root uchun git ruxsati → avtomatik yangilash (build, nginx, taymer) → " +
      "GitHub Actions (push → SSH → deploy).",
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
