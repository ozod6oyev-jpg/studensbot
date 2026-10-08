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
 *      zaxira papkasiga ko'chiriladi.
 *
 * Skript root huquqini talab qiladi (deploy.sh ning o'zi ham): root bo'lmasa
 * tekshiruv bajarilmaydi va buni ochiq aytib, xato bilan tugaydi.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("..", import.meta.url));
const REAL_SCRIPT = join(REPO_DIR, "deploy/deploy.sh");
const REAL_UNIT = join(REPO_DIR, "deploy/daftar-bot.service");

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
function run(scriptPath: string, args: string[] = [], cwd = WORK): RunResult {
  const result = spawnSync("bash", [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH ?? ""}`, HOME: `${WORK}/home` },
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

  // ---- haqiqiy deploy.sh ni yo'llari almashtirilgan holda nusxalash --------
  const original = await readFile(REAL_SCRIPT, "utf8");
  const adapted = original
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
  if (adapted === original) fail("deploy.sh da kutilgan yo'llar topilmadi — testni moslashtirish kerak.");
  const scriptPath = `${SCRIPT_DIR}/deploy.sh`;
  await writeFile(scriptPath, adapted, "utf8");
  await copyFile(REAL_UNIT, `${SCRIPT_DIR}/daftar-bot.service`);

  // ---- lokal repozitoriy (git manbasi) ------------------------------------
  await mkdir(join(REMOTE, "bot"), { recursive: true });
  await mkdir(join(REMOTE, "deploy"), { recursive: true });
  await writeFile(join(REMOTE, "bot/index.ts"), "// 1-versiya\nconsole.log(\"v1\");\n", "utf8");
  await writeFile(join(REMOTE, "package.json"), '{\n  "name": "daftar-bot-check"\n}\n', "utf8");
  await writeFile(join(REMOTE, "Readme.md"), "# Sinov repozitoriyasi\n", "utf8");
  await copyFile(REAL_SCRIPT, join(REMOTE, "deploy/deploy.sh"));
  await copyFile(REAL_UNIT, join(REMOTE, "deploy/daftar-bot.service"));
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

  if (failures > 0) {
    console.error(`\nDEPLOY TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nDeploy tekshiruvi o'tdi: clone → .env saqlanishi → pull → yangilanish → xavfsiz qayta ishga tushish → serverdagi o'zgarishlarni zaxiralash.");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
