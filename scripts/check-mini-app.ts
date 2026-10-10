/**
 * Telegram Mini App integratsiyasini tekshiradi: `bun run check:mini-app`
 *
 * Tekshiriladi:
 *  1. `bot/mini-app.ts` — `initData` imzosi: to'g'ri imzo qabul qilinadi;
 *     boshqa token, keyin o'zgartirilgan maydon, eskirgan va umuman imzosiz
 *     ma'lumot rad etiladi; `parseInitData()` va `originFromUrl()` to'g'ri;
 *     matn chegarasi Studio bilan bir xil va chegaradan uzun matn jimgina
 *     qisqartirilmaydi — 400 bilan rad etiladi (Studio ham uni o'zi to'xtatadi);
 *  2. haqiqiy bot jarayoni (`bot/index.ts`, `MINI_APP_URL` berilgan holda):
 *     · bot `setChatMenuButton` ni `web_app` turida chaqiradi (matn maydoni
 *       yonidagi tugma);
 *     · `mainKeyboard()` da Studio Mini App tugmasi paydo bo'ladi;
 *     · `POST /mini-app/send` imzolangan `initData` bilan matnni qabul qilib,
 *       chatga haqiqiy PNG varaqa yuboradi (mock Telegram API `sendPhoto` ni
 *       oladi) va Studio sozlamalari (qog'oz turi) botda qo'llanadi;
 *     · o'zgartirilgan, eskirgan yoki bo'sh `initData` 401 oladi va chatga
 *       hech narsa yuborilmaydi;
 *  3. `POST /mini-app/state` — daftarlar ro'yxati va joriy bet holati:
 *     · daftar tanlanmaguncha `activeId`/`side` bo'sh qoladi (Studio ro'yxatni
 *       ko'rsatadi);
 *     · `notebookId` berilganda o'sha daftar ochiq qilinadi va joriy bet
 *       (bet indeksi, band/bo'sh qatorlar, davom etish qatori) qaytadi;
 *     · begona yoki noma'lum daftar id'si qabul qilinmaydi;
 *     · `/mini-app/send` `notebookId` va `startLine` bilan aynan shu betning shu
 *       qatoridan yozadi (javobda qator ko'rsatiladi, qator chegaraga
 *       qisqartiriladi) va chatga yangi varaqa keladi;
 *  4. `POST /mini-app/notebook` — Mini App'dan daftar boshqaruvi:
 *     · `create` yangi daftar yaratadi (varaq soni va qog'oz turi bilan), uni
 *       darhol ochiq qiladi va ro'yxatda ko'rsatadi; noto'g'ri varaq soni rad
 *       etiladi; nom berilmasa — standart nom;
 *     · `rename` nomni almashtiradi, `remove` daftarni (ochiq bo'lsa —
 *       sozlamalardan ham) olib tashlaydi, `undo` oxirgi yozuvni qaytaradi;
 *     · `book` yozilgan betlarni PDF qilib chatga yuboradi;
 *     · faqat shu chatning daftari ustida ishlaydi: begona id, noma'lum amal,
 *       `initData`siz yoki GET so'rov rad etiladi;
 *     · `deleteRange` tanlangan oraliqni (bet/qator/so'z) o'chiradi va ketgan
 *       so'zlar sonini aytadi, `undo` esa matnni avvalgi holatiga qaytaradi;
 *       teskari (tugashi boshidan oldin) yoki yaroqsiz oraliq o'chirmaydi;
 *  5. `POST /mini-app/style` — «uslubimni nusxalash» Mini App'dan:
 *     · namuna surati base64 JPEG bo'lib keladi, bot uni o'zi o'lchaydi va
 *       eng yaqin qo'lyozmani tanlab, uslubni saqlab darhol yoqadi (holatda
 *       uslub ro'yxati va yoqilgan uslub ko'rinadi);
 *     · surat bo'lmagan (yoki umuman yuborilmagan) namuna, eski — faqat
 *       raqamli profil yuboradigan so'rov va noma'lum amal uslub yaratmaydi;
 *       `initData`siz so'rov va GET rad etiladi.
 *
 * Telegram'ning o'zi kerak emas: mock API `getUpdates`, `setChatMenuButton`,
 * `sendMessage`, `sendPhoto` va `sendDocument` ni bajaradi.
 */
import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEALTH_PATH,
  MAX_INIT_DATA_AGE_SECONDS,
  MAX_MINI_APP_CHARS,
  MINI_APP_NOTEBOOK_PATH,
  MINI_APP_PATH,
  MINI_APP_STATE_PATH,
  MINI_APP_STYLE_PATH,
  originFromUrl,
  parseInitData,
  verifyInitData,
} from "../bot/mini-app";
import { samplePhoto } from "./sample-photo";

const BOT_ENTRY = fileURLToPath(new URL("../bot/index.ts", import.meta.url));
/** Mock Telegram API'da ham, `initData` imzosida ham shu token ishlatiladi. */
const TOKEN = "111:TEST";
const MINI_APP_URL = "https://mini.test/studio";
/** Mini App ochilgan manba (CORS uchun). */
const ORIGIN = "https://mini.test";
const CHAT_ID = 4242;
/** Sinov daftari: `notebooks.json` fayli bot ishga tushishidan OLDIN yoziladi. */
const NOTEBOOK_ID = "nbsinov1";
const NOTEBOOK_TITLE = "Sinov daftari";
/** Betdagi tayyor matn — qatordan yozishni tekshirish uchun. */
const SIDE_TEXT = "Birinchi qator allaqachon yozilgan.";
/** Oraliqni o'chirish sinovidan oldin 1-betga yoziladigan matn. */
const RANGE_TEXT = "Oraliq sinovi uchun yozilgan matn.";
/** Namunadagi so'zlar (botdagi ro'yxat bilan bir xil) — uslubni nusxalash uchun. */
const SAMPLE_WORDS = "salom maktab daftar kitob qalam yozuv o'qituvchi do'stlik quyosh bahor";
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

/** PDF fayli «%PDF» bilan boshlanadi. */
function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString("latin1") === "%PDF";
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
  body: {
    ok?: boolean;
    mode?: string;
    pages?: number;
    message?: string;
    error?: string;
    /** Yozilgan bet (0 dan) va qator (1 dan) — `startLine` bilan yuborilganda. */
    side?: number | null;
    line?: number | null;
  };
}

/** `POST /mini-app/send` ga so'rov yuboradi (Mini App qilgandek). */
async function postSend(
  port: number,
  payload: {
    initData?: string;
    text?: string;
    style?: Record<string, unknown>;
    notebookId?: string;
    startLine?: number;
  },
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

interface StateSide {
  sideIndex: number;
  sideCount: number;
  text: string;
  linesPerPage: number;
  usedLines: number;
  nextLine: number;
  freeLines: number;
}

interface StateNotebook {
  id: string;
  title: string;
  sheets: number;
  paper: string;
  usedSides: number;
  capacity: number;
  active: boolean;
}

interface StateResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    ok?: boolean;
    error?: string;
    notebooks?: StateNotebook[];
    activeId?: string | null;
    side?: StateSide | null;
    style?: unknown;
    /** Saqlangan shaxsiy uslublar (uslubni nusxalash) va yoqilgani. */
    styles?: { id: string; name: string; baseFont?: string; active?: boolean }[];
    styleId?: string | null;
  };
}

/** `POST /mini-app/state` ga so'rov yuboradi (Studio holatni shunday so'raydi). */
async function postState(
  port: number,
  payload: { initData?: string; notebookId?: string },
  origin: string | null = ORIGIN,
): Promise<StateResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${MINI_APP_STATE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: StateResponse["body"] = {};
  try {
    body = JSON.parse(text) as StateResponse["body"];
  } catch {
    body = { error: text.slice(0, 120) };
  }
  return { status: response.status, headers: response.headers, body };
}

interface NotebookResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    ok?: boolean;
    message?: string;
    error?: string;
    notebookId?: string | null;
    title?: string | null;
  };
}

/** `POST /mini-app/notebook` ga so'rov yuboradi (Studio amalni shunday chaqiradi). */
async function postNotebook(
  port: number,
  payload: {
    initData?: string;
    action?: string;
    notebookId?: string;
    title?: string;
    sheets?: number;
    paper?: string;
    /** `clearSide` uchun bet indeksi (0 dan boshlanadi). */
    sideIndex?: number;
    /** `deleteRange` uchun oraliq chegaralari (1 dan boshlanadigan qator/so'z). */
    from?: { side: number; line: number; word: number };
    to?: { side: number; line: number; word: number };
  },
  origin: string | null = ORIGIN,
): Promise<NotebookResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${MINI_APP_NOTEBOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: NotebookResponse["body"] = {};
  try {
    body = JSON.parse(text) as NotebookResponse["body"];
  } catch {
    body = { error: text.slice(0, 120) };
  }
  return { status: response.status, headers: response.headers, body };
}

interface StyleResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    ok?: boolean;
    message?: string;
    error?: string;
    styleId?: string | null;
    name?: string | null;
    baseFont?: string | null;
    summary?: string | null;
  };
}

/**
 * `POST /mini-app/style` ga so'rov yuboradi (uslubni nusxalash).
 *
 * `wordsImage`/`digitsImage` — namunaning base64 (prefiksisiz) JPEG baytlari;
 * `words` maydoni ataylab qo'llab-quvvatlanadi — eski (raqamli profil yuboradigan)
 * shartnoma endi uslub yaratmasligini shu bilan tekshiramiz.
 */
async function postStyle(
  port: number,
  payload: {
    initData?: string;
    action?: string;
    wordsImage?: string;
    digitsImage?: string;
    name?: string;
    styleId?: string;
    words?: Record<string, unknown>;
  },
  origin: string | null = ORIGIN,
): Promise<StyleResponse> {
  const response = await fetch(`http://127.0.0.1:${port}${MINI_APP_STYLE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: StyleResponse["body"] = {};
  try {
    body = JSON.parse(text) as StyleResponse["body"];
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
/* 1b-qism: matn chegarasi (Studio va bot bir xil bo'lishi kerak)       */
/* ------------------------------------------------------------------ */

/**
 * Studio (brauzer) va bot alohida joyda ishlaydi, lekin matn chegarasi bir xil
 * bo'lishi shart: Studio chegaradan uzun matnni yubormaydi (o'zi aytadi), bot esa
 * uni rad etadi. Shu sababli `MINI_APP_TEXT_LIMIT` (src) va `MAX_MINI_APP_CHARS`
 * (bot) solishtiriladi.
 */
async function checkTextLimit(): Promise<void> {
  console.log("\n=== 1b-qism: matn chegarasi ===");
  const clientFile = fileURLToPath(new URL("../src/lib/telegram/mini-app.ts", import.meta.url));
  const client = await readFile(clientFile, "utf8");
  const match = /MINI_APP_TEXT_LIMIT\s*=\s*(\d+)/.exec(client);
  assert(match !== null, "Studio'dagi MINI_APP_TEXT_LIMIT topildi");
  assert(
    Number(match?.[1]) === MAX_MINI_APP_CHARS,
    `Studio va bot chegarasi bir xil (Studio ${match?.[1]}, bot ${MAX_MINI_APP_CHARS})`,
  );
  assert(
    /text\.length\s*>\s*MINI_APP_TEXT_LIMIT/.test(client),
    "Studio chegaradan uzun matnni o'zi to'xtatadi (botga yubormaydi)",
  );
}

/* ------------------------------------------------------------------ */
/* 1c-qism: Mini App studiyasi (Studio ichidagi alohida ko'rinish)      */
/* ------------------------------------------------------------------ */

/**
 * Telegram Mini App ichida Studio boshqa ko'rinishda ochiladi: oyna tor va
 * baland, shuning uchun brauzerdagi keng maket o'rniga `MiniAppStudio`
 * ishlatiladi.
 *
 * Shu qism o'sha ko'rinishning eng muhim shartlarini qo'riqlaydi: u Mini App
 * rejimida ulanadi, matn chegarasini biladi (bot bilan bir xil), tanlangan
 * daftar va qatorni yuboradi, daftar amallari shu yerda ham bor va namuna
 * matnlar brauzerdagi Studio bilan bir manbadan olinadi.
 */
async function checkMiniAppStudio(): Promise<void> {
  console.log("\n=== 1c-qism: Mini App studiyasi ===");
  const studioPage = await readFile(
    fileURLToPath(new URL("../src/pages/Studio.tsx", import.meta.url)),
    "utf8",
  );
  const studioFile = await readFile(
    fileURLToPath(new URL("../src/components/mini-app-studio.tsx", import.meta.url)),
    "utf8",
  );

  assert(
    /if\s*\(miniApp\.active\)\s*\{[\s\S]{0,400}?<MiniAppStudio/.test(studioPage),
    "Mini App rejimida Studio `MiniAppStudio` ko'rinishini beradi",
  );
  assert(
    studioFile.includes("MiniAppWriter"),
    "studiyada daftar amallari (yaratish, nom, orqaga, PDF, o'chirish) bor",
  );
  assert(
    /miniApp\.sendToChat\(/.test(studioFile),
    "studiya matnni botga `sendToChat()` bilan yuboradi",
  );
  assert(
    /notebookId: activeNotebook\?\.id \?\? undefined/.test(studioFile) &&
      /startLine: startLine \?\? undefined/.test(studioFile),
    "studiya tanlangan daftar va qatorni ham yuboradi",
  );
  assert(
    studioFile.includes("MINI_APP_TEXT_LIMIT"),
    "studiya matn chegarasini biladi (bot bilan bir xil)",
  );
  assert(
    /disabled=\{sending \|\| trimmedLength === 0 \|\| overLimit\}/.test(studioFile),
    "chegaradan uzun matn bilan yuborish tugmasi o'chadi",
  );
  assert(
    ["Matn", "Uslub", "Varaq", "Daftar"].every((label) =>
      studioFile.includes(`label: "${label}"`),
    ),
    "studiya to'rt bo'limga bo'lingan (Matn, Uslub, Varaq, Daftar)",
  );
  assert(
    studioFile.includes("@/lib/handwriting/samples") &&
      studioPage.includes("@/lib/handwriting/samples"),
    "namuna matnlar ikki ko'rinishda ham bir manbadan olinadi",
  );

  // Asboblar: studiya matn bilan ishlash, tayyor o'lchamlar va varaqani
  // kattalashtirishni o'zi taklif qilishi kerak — foydalanuvchi brauzerni
  // masshtablamasin yoki sahifani yon tomonga surmasin.
  assert(
    studioFile.includes("@/lib/handwriting/text-tools") &&
      studioPage.includes("@/lib/handwriting/text-tools"),
    "matn asboblari (tozalash, registr) ikkala ko'rinishda ham bir manbadan",
  );
  assert(
    ["trim", "collapse", "stripEmpty", "upper", "lower", "title"].every((tool) =>
      studioFile.includes(`runTextTool("${tool}")`),
    ),
    "studiya matn asboblarini taklif qiladi (bo'shliq, bo'sh qatorlar, registr)",
  );
  assert(
    studioFile.includes("GEOMETRY_PRESETS") && studioFile.includes("STYLE_RANGES"),
    "studiya tayyor o'lchamlarni va ularning oraliqlarini ishlatadi",
  );
  assert(
    /style=\{\{ width: overlayScale === null \? "100%" : `\$\{overlayScale\}%` \}\}/.test(studioFile),
    "kattalashtirish tugmalar bilan boshqariladi (barmoq bilan masshtablash shart emas)",
  );
  assert(
    studioFile.includes("overflow-auto") && /max-h-|min-h-0 flex-1 overflow-auto/.test(studioFile),
    "kattalashtirilgan varaqa faqat o'z oynasi ichida siljiydi",
  );
  assert(
    /min-w-0/.test(studioPage),
    "brauzer maketidagi ustunlar `min-w-0` bilan cheklangan (sahifa yon tomonga cho'zilmaydi)",
  );
  assert(
    /flex-col-reverse/.test(studioPage),
    "tor ekranda natija birinchi ko'rinadi (asboblar pastda)",
  );

  // Kitob ko'rinishidagi qator/so'z raqamlari botdagi o'lchov bilan aynan bir
  // xil bo'lishi shart: Mini App o'sha raqamlarni yuboradi, bot esa aynan o'sha
  // so'zlarni o'chiradi. Zaxira (kirillcha) shrift yoki shrift masshtabi
  // hisobga olinmasa, kirillcha matnda chegaralar surilib ketadi.
  const bookFile = await readFile(
    fileURLToPath(new URL("../src/components/notebook-book.tsx", import.meta.url)),
    "utf8",
  );
  const botFile = await readFile(fileURLToPath(new URL("../bot/index.ts", import.meta.url)), "utf8");
  assert(
    /measureSideText\(\{[\s\S]{0,400}?primary,[\s\S]{0,200}?secondary,/.test(bookFile),
    "Mini App bet o'lchovida zaxira (kirillcha) shrift ham beriladi",
  );
  assert(
    /sizeScale:\s*fontEntry\(id\)\?\.sizeScale\s*\?\?\s*1/.test(bookFile),
    "Mini App bet o'lchovida shrift masshtabi ham hisobga olinadi",
  );
  assert(
    /measureSideText\(\{[\s\S]{0,400}?secondary,/.test(botFile) &&
      /sizeScale:\s*fontEntry\(primaryId\)\?\.sizeScale\s*\?\?\s*1/.test(botFile),
    "botning o'lchovi ham xuddi shu shartlarni beradi (ikki tomon bir xil)",
  );
}

/* ------------------------------------------------------------------ */
/* 2-qism: bot + HTTP endpoint (mock Telegram API)                      */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  checkInitData();
  await checkTextLimit();
  await checkMiniAppStudio();

  console.log("\n=== 2-qism: bot, Mini App tugmasi va /mini-app/send ===");
  const mock = await startMockTelegram();
  const apiPort = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), "daftar-mini-app-"));

  // Daftar bazasini bot ishga tushishidan OLDIN tayyorlaymiz: shunda «daftar
  // tanlash va qatordan yozish» chat orqali daftar yaratmasdan tekshiriladi.
  // Ikkinchi daftar boshqa chatga tegishli — u hech qachon ko'rinmasligi kerak.
  await writeFile(
    join(dataDir, "notebooks.json"),
    JSON.stringify(
      {
        version: 1,
        notebooks: [
          {
            id: NOTEBOOK_ID,
            chatId: CHAT_ID,
            sheets: 12,
            paper: "lined",
            title: NOTEBOOK_TITLE,
            createdAt: Date.now() - 1000,
            sides: [{ text: SIDE_TEXT, createdAt: Date.now() - 1000 }],
          },
          {
            id: "nbbegona1",
            chatId: CHAT_ID + 1,
            sheets: 12,
            paper: "grid",
            title: "Begona daftar",
            createdAt: Date.now(),
            sides: [{ text: "Begona matn", createdAt: Date.now() }],
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

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

    // --- Daftarlar holati va qatordan boshlab yozish ----------------------
    const stateBefore = await postState(apiPort, { initData });
    assert(
      stateBefore.status === 200 && stateBefore.body.ok === true,
      `POST ${MINI_APP_STATE_PATH} → 200 ok:true (${stateBefore.status})`,
    );
    assert(
      stateBefore.body.notebooks?.length === 1 &&
        stateBefore.body.notebooks[0].title === NOTEBOOK_TITLE &&
        stateBefore.body.notebooks[0].capacity === 24,
      `holatda faqat shu chatning daftari ko'rindi ("${stateBefore.body.notebooks?.[0]?.title}", ${stateBefore.body.notebooks?.[0]?.capacity} bet)`,
    );
    assert(
      stateBefore.body.activeId === null && stateBefore.body.side === null,
      "daftar tanlanmaguncha activeId va side bo'sh qoladi",
    );

    const stateSelected = await postState(apiPort, { initData, notebookId: NOTEBOOK_ID });
    const side = stateSelected.body.side;
    assert(
      stateSelected.body.activeId === NOTEBOOK_ID &&
        stateSelected.body.notebooks?.[0]?.active === true,
      `notebookId bilan daftar ochiq qilindi (${stateSelected.body.activeId})`,
    );
    assert(
      side !== null && side !== undefined && side.sideIndex === 0 && side.text === SIDE_TEXT,
      `joriy bet va uning matni qaytdi (${side?.sideIndex}-bet)`,
    );
    assert(
      (side?.usedLines ?? 0) >= 1 && (side?.nextLine ?? 0) === (side?.usedLines ?? 0) + 1,
      `qatorlar sanaldi: ${side?.usedLines} qator band, davom etish ${side?.nextLine}-qatordan`,
    );
    assert(
      (side?.freeLines ?? 0) > 0 && (side?.linesPerPage ?? 0) > (side?.usedLines ?? 0),
      `betdagi bo'sh joy ko'rsatildi (${side?.freeLines} qator bo'sh)`,
    );

    const foreignBook = await postState(apiPort, { initData, notebookId: "nbbegona1" });
    assert(
      foreignBook.status === 200 && foreignBook.body.activeId === NOTEBOOK_ID,
      `begona chatning daftari tanlanmadi (activeId=${foreignBook.body.activeId})`,
    );

    // Tanlangan qatordan yozish: matn aynan shu betning shu qatoridan boshlanadi.
    const chosenLine = (side?.nextLine ?? 1) + 1;
    const photosBeforeLine = mock.photos.length;
    const atLine = await postSend(apiPort, {
      initData,
      text: "Tanlangan qatordan yozildi.",
      notebookId: NOTEBOOK_ID,
      startLine: chosenLine,
    });
    assert(
      atLine.status === 200 && atLine.body.mode === "notebook",
      `startLine bilan so'rov daftarga yozildi (${atLine.body.mode})`,
    );
    assert(
      atLine.body.side === 0 && atLine.body.line === chosenLine,
      `javobda bet va qator ko'rsatildi (${atLine.body.side}-bet, ${atLine.body.line}-qator)`,
    );
    assert(
      (atLine.body.message ?? "").includes(`${chosenLine}-qatoridan`),
      `xabar qatorni aytdi: "${atLine.body.message}"`,
    );
    await waitFor(() => mock.photos.length > photosBeforeLine, 40000, "yozilgan bet chatga keldi");
    assert(
      isPng(mock.photos[mock.photos.length - 1].bytes),
      "yangilangan bet chatga haqiqiy PNG bo'lib keldi",
    );

    const stateAfter = await postState(apiPort, { initData });
    assert(
      (stateAfter.body.side?.usedLines ?? 0) > (side?.usedLines ?? 0),
      `yangi yozuv holatda ko'rindi (${side?.usedLines} → ${stateAfter.body.side?.usedLines} qator)`,
    );

    // Qator raqami bet chegarasidan oshsa — eng oxirgi qatorga qisqartiriladi.
    const clamped = await postSend(apiPort, {
      initData,
      text: "Chegaradan tashqari qator.",
      notebookId: NOTEBOOK_ID,
      startLine: 9999,
    });
    assert(
      clamped.body.line === stateAfter.body.side?.linesPerPage &&
        stateAfter.body.side?.linesPerPage === side?.linesPerPage,
      `qator bet chegarasiga qisqartirildi (${clamped.body.line} = ${stateAfter.body.side?.linesPerPage})`,
    );

    // Holat so'rovi ham imzo talab qiladi.
    const stateNoInit = await postState(apiPort, {});
    assert(stateNoInit.status === 401, `initData'siz holat so'rovi 401 (${stateNoInit.status})`);
    const stateGet = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_STATE_PATH}`);
    assert(stateGet.status === 405, `GET ${MINI_APP_STATE_PATH} → 405 (${stateGet.status})`);

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
    // Chegaradan uzun matn jimgina qisqartirilmaydi — 400 bilan rad etiladi.
    const tooLong = await postSend(apiPort, {
      initData,
      text: "a".repeat(MAX_MINI_APP_CHARS + 1),
    });
    assert(
      tooLong.status === 400 && tooLong.body.ok !== true,
      `chegaradan uzun matn rad etildi (${tooLong.status}: "${tooLong.body.message ?? tooLong.body.error}")`,
    );
    assert(
      (tooLong.body.message ?? "").includes(String(MAX_MINI_APP_CHARS + 1)) &&
        (tooLong.body.message ?? "").includes(String(MAX_MINI_APP_CHARS)),
      `xabar matn uzunligini va chegarani aytdi ("${tooLong.body.message}")`,
    );
    const notPost = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_PATH}`);
    assert(notPost.status === 405, `GET ${MINI_APP_PATH} → 405 (${notPost.status})`);
    assert(
      mock.photos.length === photosBeforeRejects,
      "rad etilgan so'rovlardan keyin chatga yangi rasm kelmadi",
    );

    const unknown = await fetch(`http://127.0.0.1:${apiPort}/boshqa-yol`, { method: "POST" });
    assert(unknown.status === 404, `noma'lum yo'l 404 (${unknown.status})`);

    // --- Mini App'dan daftar boshqaruvi -----------------------------
    console.log("\n=== 3-qism: Mini App'dan daftar boshqaruvi (/mini-app/notebook) ===");

    const created = await postNotebook(apiPort, {
      initData,
      action: "create",
      sheets: 36,
      paper: "grid",
      title: "Mini App daftari",
    });
    assert(
      created.status === 200 && created.body.ok === true,
      `Mini App'da yangi daftar yaratildi (${created.status}, «${created.body.title}»)`,
    );
    const createdId = created.body.notebookId ?? "";
    assert(createdId.length > 0, `javobda yangi daftar id'si qaytdi (${createdId})`);
    assert(
      (created.body.message ?? "").includes("Mini App daftari") &&
        (created.body.message ?? "").includes("36 varaq"),
      `xabar nom va varaq sonini aytdi: "${created.body.message}"`,
    );

    const afterCreate = await postState(apiPort, { initData });
    const fresh = afterCreate.body.notebooks?.find((entry) => entry.id === createdId);
    assert(
      afterCreate.body.notebooks?.length === 2 && afterCreate.body.activeId === createdId,
      `yangi daftar ro'yxatda va darhol ochiq bo'ldi (${afterCreate.body.notebooks?.length} ta, activeId=${afterCreate.body.activeId})`,
    );
    assert(
      fresh?.sheets === 36 && fresh?.paper === "grid" && fresh?.capacity === 72,
      `varaq soni va qog'oz turi saqlandi (${fresh?.sheets} varaq, ${fresh?.paper}, ${fresh?.capacity} bet)`,
    );
    assert(
      afterCreate.body.side?.sideIndex === 0 && afterCreate.body.side?.text === "",
      `bo'sh daftarda birinchi bet ko'rsatildi (${afterCreate.body.side?.sideIndex}-bet, ${afterCreate.body.side?.usedLines} qator band)`,
    );

    const wrongSheets = await postNotebook(apiPort, { initData, action: "create", sheets: 15 });
    assert(
      wrongSheets.status === 400 &&
        wrongSheets.body.ok === false &&
        (wrongSheets.body.message ?? "").includes("Varaq soni"),
      `noto'g'ri varaq soni rad etildi (${wrongSheets.status}: "${wrongSheets.body.message}")`,
    );
    const afterReject = await postState(apiPort, { initData });
    assert(
      afterReject.body.notebooks?.length === 2,
      `rad etilgan so'rovdan keyin daftar qo'shilmadi (${afterReject.body.notebooks?.length} ta)`,
    );

    const autoNamed = await postNotebook(apiPort, { initData, action: "create", sheets: 12 });
    assert(
      autoNamed.status === 200 && (autoNamed.body.title ?? "").trim().length > 0,
      `nomsiz daftar o'zi nom oldi («${autoNamed.body.title}»)`,
    );
    const autoId = autoNamed.body.notebookId ?? "";

    const renamed = await postNotebook(apiPort, {
      initData,
      action: "rename",
      notebookId: createdId,
      title: "Fizika daftari",
    });
    assert(
      renamed.status === 200 && renamed.body.title === "Fizika daftari",
      `daftar nomi almashtirildi («${renamed.body.title}»)`,
    );
    const afterRename = await postState(apiPort, { initData, notebookId: createdId });
    assert(
      afterRename.body.notebooks?.find((entry) => entry.id === createdId)?.title === "Fizika daftari",
      "yangi nom holat so'rovida ham ko'rindi",
    );

    const foreignRename = await postNotebook(apiPort, {
      initData,
      action: "rename",
      notebookId: "nbbegona1",
      title: "Begona nom",
    });
    assert(
      foreignRename.status === 400 &&
        foreignRename.body.ok === false &&
        (foreignRename.body.message ?? "").includes("topilmadi"),
      `begona chatning daftari ustida amal bajarilmadi (${foreignRename.status}: "${foreignRename.body.message}")`,
    );
    const stillMine = await postState(apiPort, { initData, notebookId: createdId });
    assert(
      stillMine.body.notebooks?.find((entry) => entry.id === createdId)?.title === "Fizika daftari",
      "begona so'rovdan keyin o'z daftarining nomi o'zgarmadi",
    );

    const WRITTEN = "Mini App'dan yozilgan qator.";
    const wroteToCreated = await postSend(apiPort, {
      initData,
      text: WRITTEN,
      notebookId: createdId,
    });
    assert(
      wroteToCreated.status === 200 && wroteToCreated.body.mode === "notebook",
      `matn Mini App'da yaratilgan daftarga yozildi (${wroteToCreated.body.mode})`,
    );
    const afterWrite = await postState(apiPort, { initData, notebookId: createdId });
    assert(
      (afterWrite.body.side?.text ?? "").includes(WRITTEN),
      "yozilgan matn holat so'rovida ko'rindi",
    );

    const undone = await postNotebook(apiPort, { initData, action: "undo", notebookId: createdId });
    assert(
      undone.status === 200 &&
        undone.body.ok === true &&
        (undone.body.message ?? "").includes("orqaga qaytarildi"),
      `oxirgi yozuv orqaga qaytarildi ("${undone.body.message}")`,
    );
    const afterUndo = await postState(apiPort, { initData, notebookId: createdId });
    assert(
      !(afterUndo.body.side?.text ?? "").includes(WRITTEN),
      `daftar avvalgi holatiga qaytdi (${afterUndo.body.side?.usedLines} qator band)`,
    );

    const photosBeforeBook = mock.photos.length;
    const book = await postNotebook(apiPort, { initData, action: "book", notebookId: NOTEBOOK_ID });
    assert(book.status === 200 && book.body.ok === true, `yozilgan daftar kitob qilindi (${book.status})`);
    await waitFor(() => mock.photos.length > photosBeforeBook, 60000, "kitob (PDF) chatga keldi");
    const pdf = mock.photos[mock.photos.length - 1];
    assert(
      isPdf(pdf.bytes),
      `chatga haqiqiy PDF kitob yuborildi (${Math.round(pdf.bytes.length / 1024)} KB)`,
    );

    const removed = await postNotebook(apiPort, { initData, action: "remove", notebookId: createdId });
    assert(
      removed.status === 200 &&
        removed.body.ok === true &&
        (removed.body.message ?? "").includes("o'chirildi"),
      `Mini App'da yaratilgan daftar o'chirildi ("${removed.body.message}")`,
    );
    const afterRemove = await postState(apiPort, { initData });
    assert(
      afterRemove.body.notebooks?.length === 2 &&
        !afterRemove.body.notebooks?.some((entry) => entry.id === createdId) &&
        afterRemove.body.notebooks?.some((entry) => entry.id === autoId),
      `faqat o'chirilgan daftar ro'yxatdan tushdi (${afterRemove.body.notebooks?.length} ta qoldi)`,
    );
    assert(
      afterRemove.body.activeId === null,
      "o'chirilgan daftar ochiq (activeId) ro'yxatidan ham olib tashlandi",
    );

    const removedIdle = await postNotebook(apiPort, { initData, action: "remove", notebookId: autoId });
    const afterSecondRemove = await postState(apiPort, { initData });
    assert(
      removedIdle.status === 200 &&
        afterSecondRemove.body.notebooks?.length === 1 &&
        afterSecondRemove.body.notebooks?.[0]?.id === NOTEBOOK_ID,
      `ochiq bo'lmagan daftar ham o'chirildi (${afterSecondRemove.body.notebooks?.length} ta qoldi)`,
    );

    const unknownAction = await postNotebook(apiPort, { initData, action: "boshqa" });
    assert(
      unknownAction.status === 400 &&
        unknownAction.body.ok === false &&
        Boolean(unknownAction.body.error),
      `noma'lum amal rad etildi (${unknownAction.status}: "${unknownAction.body.error}")`,
    );
    const notebookGet = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_NOTEBOOK_PATH}`);
    assert(
      notebookGet.status === 405,
      `GET ${MINI_APP_NOTEBOOK_PATH} → 405 (${notebookGet.status})`,
    );
    const notebookNoInit = await postNotebook(apiPort, { action: "create", sheets: 12 });
    assert(notebookNoInit.status === 401, `initData'siz daftar amali 401 (${notebookNoInit.status})`);
    const notebookPreflight = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_NOTEBOOK_PATH}`, {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    assert(
      notebookPreflight.status === 204 &&
        notebookPreflight.headers.get("access-control-allow-origin") === ORIGIN,
      "daftar amali uchun OPTIONS preflight 204 va CORS ruxsati bilan javob berdi",
    );

    // --- Oraliqni o'chirish (deleteRange) ----------------------------
    console.log("\n=== 4-qism: Mini App'dan oraliqni o'chirish (deleteRange) ===");

    // Oldingi bo'limlar boshqa daftarlarni to'ldirib qo'ygan: holat so'rovi
    // keyingi yoziladigan betni ko'rsatadi, shuning uchun oraliq sinovi o'z
    // daftarida — 1-betga aniq matn yozib — bajariladi.
    const rangeBook = await postNotebook(apiPort, {
      initData,
      action: "create",
      title: "Oraliq sinovi",
      sheets: 12,
    });
    const rangeId = rangeBook.body.notebookId ?? "";
    assert(
      rangeBook.status === 200 && rangeBook.body.ok === true && rangeId.length > 0,
      `oraliq sinovi uchun daftar yaratildi (${rangeBook.status}: "${rangeBook.body.message}")`,
    );
    await postSend(apiPort, {
      initData,
      text: RANGE_TEXT,
      notebookId: rangeId,
      startLine: 1,
    });

    const rangeBefore = await postState(apiPort, { initData, notebookId: rangeId });
    const rangeTextBefore = rangeBefore.body.side?.text ?? "";
    const beforeWords = rangeTextBefore.split(/\s+/).filter((word) => word.length > 0);
    assert(
      beforeWords.length >= 3,
      `yangi daftarning birinchi betida yozuv bor (${beforeWords.length} so'z)`,
    );
    // Yozuv aynan qaysi betga tushgani holatdan olinadi (yozuvdan keyin u
    // «keyingi» bet bo'lib qoladi) — taxmin qilinmaydi.
    const rangeSide = rangeBefore.body.side?.sideIndex ?? 0;

    // 1-qatorning 1–2-so'zi: matnning eng boshidagi ikkita so'z o'chishi kerak.
    const rangeDeleted = await postNotebook(apiPort, {
      initData,
      action: "deleteRange",
      notebookId: rangeId,
      from: { side: rangeSide, line: 1, word: 1 },
      to: { side: rangeSide, line: 1, word: 2 },
    });
    assert(
      rangeDeleted.status === 200 && rangeDeleted.body.ok === true,
      `oraliq o'chirildi (${rangeDeleted.status}: "${rangeDeleted.body.message}")`,
    );
    assert(
      (rangeDeleted.body.message ?? "").includes("so'z o'chirildi") &&
        (rangeDeleted.body.message ?? "").includes("qaytarish mumkin"),
      `xabar o'chirilgan so'zlar va ↩️ imkoniyatini aytdi ("${rangeDeleted.body.message}")`,
    );

    const rangeAfter = await postState(apiPort, { initData, notebookId: rangeId });
    const rangeTextAfter = rangeAfter.body.side?.text ?? "";
    const afterWords = rangeTextAfter.split(/\s+/).filter((word) => word.length > 0);
    assert(
      afterWords.length === beforeWords.length - 2,
      `betdagi matn haqiqatan qisqardi (${beforeWords.length} → ${afterWords.length} so'z)`,
    );
    assert(
      afterWords.join(" ") === beforeWords.slice(2).join(" "),
      `aynan boshidagi ikki so'z o'chdi, qolgan matn joyida ("${rangeTextAfter.trim().slice(0, 40)}")`,
    );

    const rangeUndo = await postNotebook(apiPort, { initData, action: "undo", notebookId: rangeId });
    assert(
      rangeUndo.status === 200 &&
        rangeUndo.body.ok === true &&
        (rangeUndo.body.message ?? "").includes("orqaga qaytarildi"),
      `o'chirilgan oraliq ↩️ bilan qaytarildi ("${rangeUndo.body.message}")`,
    );
    const rangeRestored = await postState(apiPort, { initData, notebookId: rangeId });
    assert(
      rangeRestored.body.side?.text === rangeTextBefore,
      `bet matni avvalgi holatiga qaytdi (${rangeRestored.body.side?.usedLines} qator band)`,
    );

    // Teskari oraliq (tugashi boshidan oldin) hech narsani o'chirmaydi.
    const backwards = await postNotebook(apiPort, {
      initData,
      action: "deleteRange",
      notebookId: rangeId,
      from: { side: rangeSide, line: 2, word: 1 },
      to: { side: rangeSide, line: 1, word: 1 },
    });
    assert(
      backwards.status === 400 &&
        backwards.body.ok === false &&
        (backwards.body.message ?? "").includes("oldin"),
      `teskari oraliq rad etildi (${backwards.status}: "${backwards.body.message}")`,
    );

    // Yaroqsiz nuqta (so'z 0 dan boshlanadi) — ham rad etiladi.
    const badPoint = await postNotebook(apiPort, {
      initData,
      action: "deleteRange",
      notebookId: rangeId,
      from: { side: rangeSide, line: 1, word: 0 },
      to: { side: rangeSide, line: 1, word: 1 },
    });
    assert(
      badPoint.status === 400 &&
        badPoint.body.ok === false &&
        (badPoint.body.message ?? "").includes("noto'g'ri"),
      `yaroqsiz oraliq nuqtasi rad etildi (${badPoint.status}: "${badPoint.body.message}")`,
    );

    const rangeUntouched = await postState(apiPort, { initData, notebookId: rangeId });
    assert(
      rangeUntouched.body.side?.text === rangeTextBefore,
      "rad etilgan oraliqlardan keyin matn o'zgarmadi",
    );

    // --- Uslubni nusxalash: namuna surati botda o'lchanadi ----------------
    console.log("\n=== 5-qism: uslubni nusxalash (/mini-app/style) ===");

    const styleCountBefore = (await postState(apiPort, { initData })).body.styles?.length ?? 0;
    // Foydalanuvchi surati o'rnida haqiqiy qo'lyozma chizib, JPEG qilib yuboramiz.
    const wordsSample = (
      await samplePhoto(SAMPLE_WORDS, { paper: "lined", marginLine: true, lineGap: 70 })
    ).toString("base64");

    const styleSaved = await postStyle(apiPort, {
      initData,
      action: "measure",
      wordsImage: wordsSample,
      name: "Sinov uslubi",
    });
    assert(
      styleSaved.status === 200 && styleSaved.body.ok === true,
      `namuna surati botda o'lchandi, uslub saqlandi (${styleSaved.status}: "${styleSaved.body.message}")`,
    );
    assert(
      (styleSaved.body.styleId ?? "").length > 0 &&
        styleSaved.body.name === "Sinov uslubi" &&
        (styleSaved.body.baseFont ?? "").length > 0,
      `javobda uslub id'si, nomi va asos shrift qaytdi (${styleSaved.body.styleId}, «${styleSaved.body.name}», ${styleSaved.body.baseFont})`,
    );

    const styleState = await postState(apiPort, { initData });
    const styleEntry = styleState.body.styles?.find((entry) => entry.id === styleSaved.body.styleId);
    assert(
      (styleState.body.styles?.length ?? 0) === styleCountBefore + 1 &&
        styleEntry?.name === "Sinov uslubi" &&
        styleEntry?.active === true &&
        styleState.body.styleId === styleSaved.body.styleId,
      `saqlangan uslub darhol yoqildi va holatda ko'rindi (${styleState.body.styles?.length} ta uslub, active=${styleEntry?.active})`,
    );

    // Surat bo'lmagan namuna: o'lchab bo'lmaydi — uslub yaratilmaydi.
    const notImage = await postStyle(apiPort, {
      initData,
      action: "measure",
      wordsImage: Buffer.from("bu rasm emas, oddiy matn").toString("base64"),
    });
    assert(
      notImage.status === 400 &&
        notImage.body.ok === false &&
        (notImage.body.message ?? "").length > 0,
      `rasm bo'lmagan namuna rad etildi (${notImage.status}: "${notImage.body.message}")`,
    );

    const noImage = await postStyle(apiPort, { initData, action: "measure" });
    assert(
      noImage.status === 400 && noImage.body.ok === false,
      `namunasiz o'lchash rad etildi (${noImage.status}: "${noImage.body.message}")`,
    );

    // Eski shartnoma: faqat raqamli profil yuborilgan so'rov endi o'lchanmaydi.
    const oldContract = await postStyle(apiPort, {
      initData,
      action: "measure",
      words: { lines: 3, inkPixels: 1200, slant: 0.1 },
      name: "Eski shartnoma",
    });
    assert(
      oldContract.status === 400 && oldContract.body.ok === false,
      `raqamli profil yuboradigan eski so'rov uslub yaratmadi (${oldContract.status})`,
    );

    const styleUnknownAction = await postStyle(apiPort, { initData, action: "boshqa-amal" });
    assert(
      styleUnknownAction.status === 400 && styleUnknownAction.body.ok === false,
      `noma'lum uslub amali rad etildi (${styleUnknownAction.status}: "${styleUnknownAction.body.error}")`,
    );

    const styleNoInit = await postStyle(apiPort, { action: "measure", wordsImage: wordsSample });
    assert(styleNoInit.status === 401, `initData'siz uslub so'rovi 401 (${styleNoInit.status})`);
    const styleGet = await fetch(`http://127.0.0.1:${apiPort}${MINI_APP_STYLE_PATH}`);
    assert(styleGet.status === 405, `GET ${MINI_APP_STYLE_PATH} → 405 (${styleGet.status})`);

    const stylesAfterRejects = await postState(apiPort, { initData });
    assert(
      (stylesAfterRejects.body.styles?.length ?? 0) === styleCountBefore + 1,
      `rad etilgan so'rovlar yangi uslub qo'shmadi (${stylesAfterRejects.body.styles?.length} ta qoldi)`,
    );
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
