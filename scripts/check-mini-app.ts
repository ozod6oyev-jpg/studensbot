/**
 * Telegram Mini App integratsiyasini tekshiradi: `bun run check:mini-app`
 *
 * Tekshiriladi:
 *  1. `bot/mini-app.ts` — `initData` imzosi: to'g'ri imzo qabul qilinadi;
 *     boshqa token, keyin o'zgartirilgan maydon, eskirgan va umuman imzosiz
 *     ma'lumot rad etiladi; `parseInitData()` va `originFromUrl()` to'g'ri;
 *  2. haqiqiy bot jarayoni (`bot/index.ts`, `MINI_APP_URL` berilgan holda):
 *     · bot `setChatMenuButton` ni `web_app` turida chaqiradi (matn maydoni
 *       yonidagi tugma);
 *     · `mainKeyboard()` da Studio Mini App tugmasi paydo bo'ladi;
 *     · `POST /mini-app/send` imzolangan `initData` bilan matnni qabul qilib,
 *       chatga haqiqiy PNG varaqa yuboradi (mock Telegram API `sendPhoto` ni
 *       oladi) va Studio sozlamalari (qog'oz turi) botda qo'llanadi;
 *     · o'zgartirilgan, eskirgan yoki bo'sh `initData` 401 oladi va chatga
 *       hech narsa yuborilmaydi.
 *
 * Telegram'ning o'zi kerak emas: mock API `getUpdates`, `setChatMenuButton`,
 * `sendMessage` va `sendPhoto` ni bajaradi.
 */
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEALTH_PATH,
  MAX_INIT_DATA_AGE_SECONDS,
  MINI_APP_PATH,
  originFromUrl,
  parseInitData,
  verifyInitData,
} from "../bot/mini-app";

const BOT_ENTRY = fileURLToPath(new URL("../bot/index.ts", import.meta.url));
/** Mock Telegram API'da ham, `initData` imzosida ham shu token ishlatiladi. */
const TOKEN = "111:TEST";
const MINI_APP_URL = "https://mini.test/studio";
/** Mini App ochilgan manba (CORS uchun). */
const ORIGIN = "https://mini.test";
const CHAT_ID = 4242;
/** Telegram WebApp `initData` ichidagi foydalanuvchi. */
const USER = { id: CHAT_ID, first_name: "Aziz", username: "aziz" };

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

/* ------------------------------------------------------------------ */
/* initData imzosi (Telegram hujjatlaridagi formula)                    */
/* ------------------------------------------------------------------ */

/** `data_check_string` uchun hash: HMAC_SHA256(data, HMAC_SHA256("WebAppData", token)). */
function initDataHash(fields: Record<string, string>, token = TOKEN): string {
  const pairs = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
}

/** Berilgan maydonlar va hash'dan `initData` satri yasaydi. */
function initDataWith(fields: Record<string, string>, hash: string): string {
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

/** To'g'ri imzolangan `initData`. */
function signInitData(fields: Record<string, string>, token = TOKEN): string {
  return initDataWith(fields, initDataHash(fields, token));
}

/** Hozirgi vaqt bilan imzolangan standart `initData`. */
function freshFields(now = Date.now()): Record<string, string> {
  return {
    auth_date: String(Math.floor(now / 1000)),
    query_id: "AAHminiapp",
    user: JSON.stringify(USER),
  };
}

/* ------------------------------------------------------------------ */
/* Mock Telegram API                                                    */
/* ------------------------------------------------------------------ */

function partBytes(body: Buffer, boundary: string, field: string): Buffer | null {
  const marker = Buffer.from(`name="${field}"`);
  const index = body.indexOf(marker);
  if (index === -1) return null;
  const afterHeaders = body.indexOf("\r\n\r\n", index);
  if (afterHeaders === -1) return null;
  const start = afterHeaders + 4;
  const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), start);
  return body.subarray(start, next === -1 ? body.length : next);
}

function partText(body: Buffer, boundary: string, field: string): string {
  const bytes = partBytes(body, boundary, field);
  return bytes ? bytes.toString("utf8").trimEnd() : "";
}

interface ReceivedPhoto {
  bytes: Buffer;
  caption: string;
}

interface ReceivedText {
  text: string;
  markup: string;
}

interface MockTelegram {
  server: Server;
  port: number;
  photos: ReceivedPhoto[];
  texts: ReceivedText[];
  /** Chaqirilgan metodlar nomlari (tartibi bilan). */
  calls: string[];
  /** `setChatMenuButton` tanasi (JSON satr). */
  menuButtons: string[];
  /** Xuddi foydalanuvchi yozgandek update qo'shadi. */
  push(update: unknown): void;
}

async function startMockTelegram(): Promise<MockTelegram> {
  const photos: ReceivedPhoto[] = [];
  const texts: ReceivedText[] = [];
  const calls: string[] = [];
  const menuButtons: string[] = [];
  const updates: unknown[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = request.url ?? "";
      const method = url.split("/bot")[1]?.split("/")[1]?.split("?")[0] ?? "";
      calls.push(method);

      const reply = (payload: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      switch (method) {
        case "getMe":
          reply({ ok: true, result: { id: 1, username: "daftar_test_bot", first_name: "Daftar Test" } });
          break;
        case "getWebhookInfo":
          reply({ ok: true, result: { url: "", pending_update_count: 0 } });
          break;
        case "deleteWebhook":
        case "setWebhook":
        case "sendChatAction":
          reply({ ok: true, result: true });
          break;
        case "setChatMenuButton":
          menuButtons.push(body.toString("utf8"));
          reply({ ok: true, result: true });
          break;
        case "getUpdates": {
          const next = updates.splice(0, updates.length);
          // Botning uzoq so'rovini kutmaslik uchun kichik kechikish.
          setTimeout(() => reply({ ok: true, result: next }), 150);
          break;
        }
        case "sendMessage": {
          const parsed = JSON.parse(body.toString("utf8") || "{}") as {
            text?: string;
            reply_markup?: unknown;
          };
          texts.push({
            text: parsed.text ?? "",
            markup: parsed.reply_markup ? JSON.stringify(parsed.reply_markup) : "",
          });
          reply({ ok: true, result: { message_id: texts.length } });
          break;
        }
        case "sendPhoto":
        case "sendDocument": {
          const contentType = request.headers["content-type"] ?? "";
          const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
          const file = partBytes(body, boundary, method === "sendPhoto" ? "photo" : "document");
          if (!file) {
            reply({ ok: false, description: "fayl topilmadi" });
            break;
          }
          photos.push({
            bytes: Buffer.from(file),
            caption: partText(body, boundary, "caption"),
          });
          reply({ ok: true, result: { message_id: photos.length } });
          break;
        }
        default:
          reply({ ok: true, result: true });
      }
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    server,
    port,
    photos,
    texts,
    calls,
    menuButtons,
    push: (update: unknown) => updates.push(update),
  };
}

/* ------------------------------------------------------------------ */
/* Yordamchilar                                                         */
/* ------------------------------------------------------------------ */

/** Bo'sh portni topadi (botning HTTP serveri uchun). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

function isPng(bytes: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => bytes[index] === byte);
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Kutilgan natija kelmadi (${label}), ${timeoutMs} ms ichida topilmadi.`);
}

interface SendResponse {
  status: number;
  /** Javob sarlavhalari (`Headers` bilan bir xil ko'rinish; DOM tiplariga bog'lanmaydi). */
  headers: { get(name: string): string | null };
  body: { ok?: boolean; mode?: string; pages?: number; message?: string; error?: string };
}

/** `POST /mini-app/send` ga so'rov yuboradi (Mini App qilgandek). */
async function postSend(
  port: number,
  payload: { initData?: string; text?: string; style?: Record<string, unknown> },
  origin: string | null = ORIGIN,
): Promise<SendResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${MINI_APP_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: SendResponse["body"] = {};
  try {
    body = JSON.parse(text) as SendResponse["body"];
  } catch {
    body = { error: text.slice(0, 120) };
  }
  return { status: response.status, headers: response.headers, body };
}

/** `/healthz` javobini kutadi (server ko'tarilishini shu bilan bilamiz). */
async function waitForHealth(port: number, timeoutMs: number): Promise<string> {
  const started = Date.now();
  let lastError = "javob yo'q";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`);
      if (response.ok) return (await response.text()).trim();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`HTTP server javob bermadi (${lastError}).`);
}

/* ------------------------------------------------------------------ */
/* 1-qism: initData tekshiruvi (bot/mini-app.ts)                        */
/* ------------------------------------------------------------------ */

function checkInitData(): void {
  console.log("\n=== 1-qism: initData imzosi ===");
  const now = Date.now();
  const initData = signInitData(freshFields(now));

  const valid = verifyInitData(initData, TOKEN, { now });
  assert(valid.ok, "to'g'ri imzolangan initData qabul qilindi");
  if (valid.ok) {
    assert(valid.user?.id === CHAT_ID, `user.id o'qildi (${valid.user?.id})`);
    assert(valid.user?.first_name === "Aziz", "foydalanuvchi ismi o'qildi");
    assert(valid.authDate === Math.floor(now / 1000), "auth_date o'qildi");
  }

  assert(!verifyInitData(initData, "222:TEST", { now }).ok, "boshqa bot tokeni bilan imzo mos kelmadi");

  const fields = freshFields(now);
  const tampered = initDataWith(
    { ...fields, user: JSON.stringify({ id: 999_999, first_name: "Boshqa" }) },
    initDataHash(fields),
  );
  assert(!verifyInitData(tampered, TOKEN, { now }).ok, "o'zgartirilgan (hash mos kelmagan) initData rad etildi");

  const staleFields = { ...freshFields(now), auth_date: String(Math.floor(now / 1000) - MAX_INIT_DATA_AGE_SECONDS - 60) };
  assert(!verifyInitData(signInitData(staleFields), TOKEN, { now }).ok, "eskirgan initData rad etildi");

  assert(!verifyInitData("auth_date=1&user=%7B%7D", TOKEN, { now }).ok, "imzosiz (hash'siz) initData rad etildi");
  assert(!verifyInitData("", TOKEN, { now }).ok, "bo'sh initData rad etildi");
  assert(!verifyInitData(initData, "", { now }).ok, "tokensiz tekshiruv rad etildi");

  const missingAuth = signInitData({ query_id: "AAH" });
  assert(!verifyInitData(missingAuth, TOKEN, { now }).ok, "auth_date'siz initData rad etildi");

  const params = parseInitData("a=1&b=salom%20dunyo&a=2");
  assert(params.get("b") === "salom dunyo", "parseInitData() foizli kodlashni ochdi");
  assert(params.get("a") === "2", "takrorlangan kalitda oxirgi qiymat olinadi");

  assert(originFromUrl(MINI_APP_URL) === ORIGIN, `originFromUrl() manba ajratdi (${ORIGIN})`);
  assert(originFromUrl("domen-uz") === undefined, "noto'g'ri manzil uchun originFromUrl() = undefined");
}

/* ------------------------------------------------------------------ */
/* 2-qism: bot + HTTP endpoint (mock Telegram API)                      */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  checkInitData();

  console.log("\n=== 2-qism: bot, Mini App tugmasi va /mini-app/send ===");
  const mock = await startMockTelegram();
  const apiPort = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), "daftar-mini-app-"));
  console.log(`Mock Telegram: http://127.0.0.1:${mock.port}  (bot: http://127.0.0.1:${apiPort})`);

  const child: ChildProcess = spawn("bun", [BOT_ENTRY], {
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_API_BASE: `http://127.0.0.1:${mock.port}`,
      BOT_DATA_DIR: dataDir,
      MINI_APP_URL,
      PORT: String(apiPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));

  try {
    await waitFor(() => mock.calls.includes("setChatMenuButton"), 20000, "menyu tugmasi bog'landi");
    const menu = mock.menuButtons.at(-1) ?? "";
    assert(menu.includes('"type":"web_app"'), "setChatMenuButton web_app turida chaqirildi");
    assert(menu.includes(MINI_APP_URL), `menyu tugmasi MINI_APP_URL ga qaratilgan (${MINI_APP_URL})`);

    const health = await waitForHealth(apiPort, 20000);
    assert(health === "ok", `GET ${HEALTH_PATH} → "${health}"`);

    // Pastdagi menyudagi Studio tugmasi.
    mock.push({
      update_id: 1,
      message: { message_id: 1, chat: { id: CHAT_ID, type: "private" }, text: "/start" },
    });
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("Assalomu alaykum")),
      20000,
      "salomlashuv xabari",
    );
    const greeting = mock.texts.filter((entry) => entry.text.includes("Assalomu alaykum")).pop();
    assert(
      (greeting?.markup ?? "").includes('"web_app"') && (greeting?.markup ?? "").includes(MINI_APP_URL),
      "pastdagi menyuda Studio Mini App tugmasi bor",
    );

    // Studio Mini App natijasini chatga yuboradi.
    const initData = signInitData(freshFields());
    const before = mock.photos.length;
    const sent = await postSend(apiPort, {
      initData,
      text: "Mini App orqali yozilgan matn.",
      style: { paper: "grid", ink: "blue" },
    });
    assert(sent.status === 200 && sent.body.ok === true, `valid initData bilan 200 ok:true (${sent.status})`);
    assert(
      sent.body.mode === "pages" && (sent.body.pages ?? 0) >= 1,
      `javobda mode="pages" va pages ≥ 1 (${sent.body.mode}, ${sent.body.pages})`,
    );
    assert(
      sent.headers.get("access-control-allow-origin") === ORIGIN,
      "javobda Mini App manbasi uchun CORS ruxsati bor",
    );

    await waitFor(() => mock.photos.length > before, 40000, "chatga varaqa keldi");
    const first = mock.photos[mock.photos.length - 1];
    assert(isPng(first.bytes), `chatga haqiqiy PNG yuborildi (${first.bytes.length} bayt)`);
    assert(
      first.caption.includes("Studio'dan yuborildi"),
      `izohda manba ko'rsatilgan ("${first.caption.split("\n").pop()}")`,
    );

    // Studio sozlamalari botda qo'llanadi: boshqa qog'oz turi — boshqa izoh.
    const second = await postSend(apiPort, {
      initData,
      text: "Mini App orqali yozilgan matn.",
      style: { paper: "lined", ink: "blue" },
    });
    assert(second.status === 200, "ikkinchi so'rov ham qabul qilindi");
    await waitFor(() => mock.photos.length > before + 1, 40000, "ikkinchi varaqa keldi");
    const latest = mock.photos[mock.photos.length - 1];
    assert(
      latest.caption.split("\n")[0] !== first.caption.split("\n")[0],
      `Studio sozlamasi botda qo'llandi ("${latest.caption.split("\n")[0]}")`,
    );

    // CORS preflight.
    const preflight = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_PATH}`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    assert(
      preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === ORIGIN,
      "OPTIONS preflight 204 va CORS ruxsati bilan javob berdi",
    );
    const foreign = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_PATH}`, {
      method: "OPTIONS",
      headers: { origin: "https://begona.example" },
    });
    assert(
      foreign.headers.get("access-control-allow-origin") === null,
      "begona domen uchun CORS ruxsati berilmadi",
    );

    // Rad etiladigan so'rovlar.
    const photosBeforeRejects = mock.photos.length;
    const wrong = await postSend(apiPort, { initData: tamperedInitData(), text: "yozilmasin" });
    assert(wrong.status === 401, `o'zgartirilgan initData 401 (${wrong.status})`);
    const stale = await postSend(apiPort, {
      initData: signInitData({
        ...freshFields(),
        auth_date: String(Math.floor(Date.now() / 1000) - MAX_INIT_DATA_AGE_SECONDS - 60),
      }),
      text: "yozilmasin",
    });
    assert(stale.status === 401, `eskirgan initData 401 (${stale.status})`);
    const noInit = await postSend(apiPort, { text: "yozilmasin" });
    assert(noInit.status === 401, `initData'siz so'rov 401 (${noInit.status})`);
    const empty = await postSend(apiPort, { initData, text: "   " });
    assert(empty.status === 400, `bo'sh matn 400 (${empty.status})`);
    const notPost = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_PATH}`);
    assert(notPost.status === 405, `GET ${MINI_APP_PATH} → 405 (${notPost.status})`);
    assert(
      mock.photos.length === photosBeforeRejects,
      "rad etilgan so'rovlardan keyin chatga yangi rasm kelmadi",
    );

    const unknown = await fetch(`http://127.0.0.1:${apiPort}/boshqa-yol`, { method: "POST" });
    assert(unknown.status === 404, `noma'lum yo'l 404 (${unknown.status})`);
  } finally {
    child.kill();
    mock.server.close();
  }

  if (failures > 0) {
    console.error(`\nBot loglari (oxirgi qatorlar):\n${logs.join("").split("\n").slice(-12).join("\n")}`);
    console.error(`\nTEKSHIRUV YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nMini App tekshiruvi o'tdi.");
}

/** Test uchun: hash to'g'ri, lekin maydon o'zgartirilgan `initData`. */
function tamperedInitData(): string {
  const fields = freshFields();
  return initDataWith(
    { ...fields, user: JSON.stringify({ id: 999_999, first_name: "Boshqa" }) },
    initDataHash(fields),
  );
}

main().catch((error) => {
  console.error("TEKSHIRUV YIQILDI:", error);
  process.exit(1);
});
