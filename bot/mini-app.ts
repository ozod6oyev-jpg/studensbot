/**
 * Telegram Mini App endpointi.
 *
 * Studio sahifasi Telegram ichida (`web_app` tugmasi orqali) ochilganda
 * `window.Telegram.WebApp.initData` satrini oladi va shu yerga yuboradi:
 *
 *   POST /mini-app/send     { initData, text, style, notebookId?, startLine? }
 *   POST /mini-app/state    { initData, notebookId? } → daftarlar + joriy bet
 *   POST /mini-app/notebook { initData, action, notebookId?, title?, sheets?, paper? }
 *   GET  /healthz           → "ok"
 *
 * `initData` — Telegram imzolagan ma'lumot: bot tokeni bilan HMAC-SHA256
 * tekshiriladi (`hash` maydonidan tashqari barcha juftliklar alifbo tartibida
 * `key=value` qilib birlashtiriladi). Tekshiruv o'tgach, undagi `user.id` —
 * chat ID bo'ladi va natija o'sha chatga yuboriladi. Shu sababli Mini App
 * foydalanuvchini alohida ro'yxatdan o'tkazish yoki parol talab qilmaydi.
 *
 * Modul Telegram API'sini bilmaydi: chizish va yuborish ishini `send()`
 * chaqiruvchisi (bot) bajaradi — shu tufayli uni alohida sinash mumkin.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MINI_APP_PATH = "/mini-app/send";
/** Daftarlar ro'yxati va joriy bet holati (Studio yozishdan oldin tanlaydi). */
export const MINI_APP_STATE_PATH = "/mini-app/state";
/** Daftar bilan ishlash: yaratish, nomlash, o'chirish, orqaga qaytarish, PDF. */
export const MINI_APP_NOTEBOOK_PATH = "/mini-app/notebook";
/** Mini App'dan chaqiriladigan daftar amallari. */
export type MiniAppNotebookAction =
  | "create"
  | "rename"
  | "remove"
  | "undo"
  | "book"
  /** Bitta betdagi yozuvni o'chirish. */
  | "clearSide"
  /** Betlar/qatorlar/so'zlar bo'yicha oraliqni o'chirish. */
  | "deleteRange";
export const MINI_APP_NOTEBOOK_ACTIONS: MiniAppNotebookAction[] = [
  "create",
  "rename",
  "remove",
  "undo",
  "book",
  "clearSide",
  "deleteRange",
];
/** Shaxsiy uslub: o'lchash, yoqish, o'chirish. */
export const MINI_APP_STYLE_PATH = "/mini-app/style";
export type MiniAppStyleAction = "measure" | "apply" | "remove";
export const MINI_APP_STYLE_ACTIONS: MiniAppStyleAction[] = ["measure", "apply", "remove"];
export const HEALTH_PATH = "/healthz";
/** `initData` shu vaqtdan eski bo'lsa qabul qilinmaydi (o'g'irlangan ma'lumot uchun). */
export const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
/**
 * Odatdagi (matnli) so'rov tanasining eng katta hajmi. Namuna suratlari bor
 * uslub so'rovi uchun alohida, kattaroq chegara ishlatiladi
 * (`MAX_STYLE_BODY_BYTES`).
 */
const MAX_BODY_BYTES = 256 * 1024;
/**
 * Uslub so'rovi namuna suratlarini (base64) olib keladi, shuning uchun odatdagi
 * matn chegarasidan ancha katta: brauzer suratni avval kichraytirib yuboradi,
 * lekin telefon suratining base64 ko'rinishi baribir bir necha yuz kilobayt.
 */
export const MAX_STYLE_BODY_BYTES = 12 * 1024 * 1024;
/**
 * Bitta so'rovda yuboriladigan eng ko'p belgi.
 *
 * Studio'dagi `MINI_APP_TEXT_LIMIT` bilan **bir xil** bo'lishi kerak
 * (`check:mini-app` ikkala qiymatni solishtiradi). Chegaradan uzun matn jimgina
 * qisqartirilmaydi — 400 bilan rad etiladi, aks holda foydalanuvchi nima
 * yuborilganini bilmay qolardi.
 */
export const MAX_MINI_APP_CHARS = 4000;

export interface MiniAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type InitDataCheck =
  | { ok: true; user?: MiniAppUser; authDate: number; chatType?: string }
  | { ok: false; error: string };

export interface MiniAppRequest {
  /** `initData` dan olingan chat ID (shaxsiy chatda — foydalanuvchi id'si). */
  chatId: number;
  user?: MiniAppUser;
  text: string;
  /** Studio'dagi sozlamalar; tekshirish chaqiruvchi tomonda. */
  style?: unknown;
  /** Studio tanlagan daftar (bo'lmasa — botdagi ochiq daftar). */
  notebookId?: string;
  /** Studio tanlagan qator: 1 dan boshlab (bo'lmasa — oxirgi yozuv tagidan). */
  startLine?: number;
}

/**
 * Holat so'rovi: `notebookId` berilsa, o'sha daftar ochiq qilib qo'yiladi.
 *
 * `spreadIndex` berilsa, javobda daftarning **ochilgan ko'rinishi** (ikki
 * qarama-qarshi bet) ham qaytariladi — Mini App daftarni kitobdek ko'rsatadi.
 */
export interface MiniAppStateRequest {
  chatId: number;
  user?: MiniAppUser;
  notebookId?: string;
  spreadIndex?: number;
}

/** Bitta daftar haqida Studio ko'rsatadigan qisqa ma'lumot. */
export interface MiniAppNotebookInfo {
  id: string;
  title: string;
  sheets: number;
  paper: string;
  usedSides: number;
  capacity: number;
  active: boolean;
}

/** Tanlangan daftarning joriy beti: qaysi betga, qaysi qatordan yoziladi. */
export interface MiniAppSideInfo {
  /** 0 dan boshlanadigan bet indeksi (Studio'da `sideIndex + 1` ko'rinadi). */
  sideIndex: number;
  /** Nechta bet band qilingan. */
  sideCount: number;
  /** Shu betdagi matn (Studio uni chizib ko'rsatadi). */
  text: string;
  /** Bir betga sig'adigan qatorlar soni. */
  linesPerPage: number;
  /** Band qatorlar soni. */
  usedLines: number;
  /** Davom etish taklif qilinadigan qator (1 dan boshlab). */
  nextLine: number;
  /** Shu betdagi bo'sh qatorlar soni. */
  freeLines: number;
}

/**
 * Ochilgan daftardagi bitta bet (kitob ko'rinishining bir tomoni).
 *
 * `style` — shu betning o'z uslubi: betning tomoni (chegara chapda yoki o'ngda)
 * bet indeksiga qarab almashadi, shu sababli har bet o'z uslubi bilan chiziladi.
 */
export interface MiniAppSpreadSide {
  index: number;
  text: string;
  style: unknown;
}

/**
 * Daftarning ochilgan ko'rinishi: chap va o'ng betlar bir joydan (muqovadan)
 * birlashtirilgan. Mavjud bo'lmagan bet `null` — Mini App bo'sh varaqa chizadi.
 */
export interface MiniAppSpread {
  /** Nechanchi ko'rinish (0 dan boshlanadi): `[2k, 2k+1]` betlar jufti. */
  index: number;
  /** Nechta ko'rinish bor (band betlar asosida). */
  total: number;
  left: MiniAppSpreadSide | null;
  right: MiniAppSpreadSide | null;
  /** Band betlar soni — "3/24 bet" ko'rsatkichi uchun. */
  usedSides: number;
  /** Jami betlar soni. */
  capacity: number;
}

/** Chatdagi saqlangan shaxsiy uslub (Mini App ro'yxati uchun). */
export interface MiniAppStyleInfo {
  id: string;
  name: string;
  baseFont: string;
  summary: string;
  active: boolean;
}

/** `POST /mini-app/state` javobi. */
export interface MiniAppState {
  notebooks: MiniAppNotebookInfo[];
  activeId: string | null;
  side: MiniAppSideInfo | null;
  /** Daftar ochiq ko'rinishda (ikki bet) — faqat `spreadIndex` so'ralganda. */
  spread?: MiniAppSpread | null;
  /** Saqlangan shaxsiy uslublar (uslubni almashtirish uchun). */
  styles: MiniAppStyleInfo[];
  /** Yoqilgan uslub id'si (bo'lmasa — `null`). */
  styleId: string | null;
  /** Chat uslubi (daftar bo'lsa — o'sha daftarning qog'ozi bilan). */
  style: unknown;
}

/**
 * `POST /mini-app/notebook` so'rovi — chatdagi daftarni boshqarish.
 *
 * Chat bot chatidagi tugmalar bilan bir xil ishlarni qiladi: `create` — yangi
 * daftar (varaq soni va qog'oz turi bilan), `rename` — nomni almashtirish,
 * `remove` — o'chirish, `undo` — oxirgi tahrirni orqaga qaytarish, `book` —
 * yozilgan betlarni PDF kitob qilib chatga yuborish. Yozish/o'chirish bilan
 * bog'liq murakkab oqimlar (oraliqni o'chirish) botda qoladi.
 */
export interface MiniAppNotebookRequest {
  chatId: number;
  user?: MiniAppUser;
  action: MiniAppNotebookAction;
  /** Qaysi daftar ustida ish bajariladi (`create` uchun shart emas). */
  notebookId?: string;
  /** `create`/`rename` uchun nom (bo'sh bo'lsa — standart nom). */
  title?: string;
  /** `create` uchun varaq soni (12/36/48/96); tekshirish chaqiruvchi tomonda. */
  sheets?: unknown;
  /** `create` uchun qog'oz turi (`lined`/`grid`/`plain`); tekshirish chaqiruvchi tomonda. */
  paper?: unknown;
  /** `clearSide` uchun bet indeksi (0 dan boshlanadi). */
  sideIndex?: unknown;
  /** `deleteRange` uchun oraliq chegaralari (1 dan boshlanadigan qator/so'z). */
  from?: unknown;
  to?: unknown;
}

/** O'chirish oralig'ining bir nuqtasi (bet indeksi 0 dan, qator/so'z 1 dan). */
export interface MiniAppPoint {
  side: number;
  line: number;
  word: number;
}

/**
 * `POST /mini-app/style` so'rovi — shaxsiy uslub (uslubni nusxalash).
 *
 * O'lchash ishi botda bajariladi: Mini App namuna suratlarini (base64 JPEG)
 * yuboradi, bot esa o'lchab, o'z shrift fayllari bilan solishtirib, eng yaqin
 * qo'lyozmani tanlaydi va uslubni saqlaydi — shunda brauzerga shrift fayllarini
 * ham, rasm dekodlash uchun og'ir kutubxonalarni ham yuklash shart bo'lmaydi.
 */
export interface MiniAppStyleRequest {
  chatId: number;
  user?: MiniAppUser;
  action: MiniAppStyleAction;
  /** `measure`: so'zlar namunasi — base64 (prefiksisiz) JPEG baytlari. */
  wordsImage?: string;
  /** `measure`: raqamlar namunasi — xuddi shunday base64 JPEG. */
  digitsImage?: string;
  /** `measure`: uslub nomi (bo'sh bo'lsa — bot o'zi nom beradi). */
  name?: string;
  /** `apply`/`remove`: qaysi saqlangan uslub. */
  styleId?: string;
}

/** `POST /mini-app/style` javobi. */
export interface MiniAppStyleResult {
  ok: boolean;
  message: string;
  styleId?: string | null;
  name?: string | null;
  baseFont?: string | null;
  summary?: string | null;
}

/** `POST /mini-app/notebook` javobi (xato ham shu ko'rinishda qaytadi). */
export interface MiniAppNotebookResult {
  /** Amal bajarildimi (`false` bo'lsa `message` sababni aytadi). */
  ok: boolean;
  /** Foydalanuvchiga ko'rsatiladigan qisqa xabar. */
  message: string;
  /** Yaratilgan (yoki o'zgargan) daftar id'si — Studio shuni tanlab qo'yadi. */
  notebookId?: string | null;
  /** Daftar nomi (yaratish/nomlashdan keyin). */
  title?: string | null;
}

export interface MiniAppResult {
  /** `pages` — alohida varaqalar, `notebook` — ochiq daftarga yozildi. */
  mode: "pages" | "notebook";
  /** Chatga yuborilgan varaqalar soni. */
  pages: number;
  /** Yozilgan daftar nomi (bo'lsa). */
  notebook?: string | null;
  /** Yozilgan bet indeksi (0 dan boshlab) — Studio tanlagan qator uchun. */
  side?: number;
  /** Yozish boshlangan qator (1 dan boshlab). */
  line?: number;
  /** Foydalanuvchiga ko'rsatiladigan qo'shimcha izoh. */
  note?: string;
}

export interface MiniAppHandlerOptions {
  /** Bot tokeni — `initData` imzosini tekshirish uchun. */
  token: string;
  /** Matnni chizib, chatga yuboradigan funksiya. */
  send: (request: MiniAppRequest) => Promise<MiniAppResult>;
  /**
   * Daftarlar ro'yxati va joriy bet holati (`POST /mini-app/state`).
   * Berilmasa, holat so'rovi 503 bilan javob oladi (faqat yuborish ishlaydi).
   */
  state?: (request: MiniAppStateRequest) => Promise<MiniAppState>;
  /**
   * Daftar bilan ishlash (`POST /mini-app/notebook`). Berilmasa, bu yo'l 503
   * bilan javob oladi (Studio faqat yozishni taklif qiladi).
   */
  notebook?: (request: MiniAppNotebookRequest) => Promise<MiniAppNotebookResult>;
  /**
   * Shaxsiy uslub (`POST /mini-app/style`). Berilmasa, bu yo'l 503 qaytaradi.
   */
  style?: (request: MiniAppStyleRequest) => Promise<MiniAppStyleResult>;
  /**
   * CORS uchun ruxsat etilgan manbalar (masalan, `MINI_APP_URL` domeni).
   * Bo'sh bo'lsa har qanday manba javobni o'qiy oladi — xavfsizlikni
   * `initData` imzosi ta'minlaydi; ro'yxat berilsa faqat o'shalar.
   */
  allowedOrigins?: string[];
  log?: (message: string) => void;
}

/* ------------------------------------------------------------------ */
/* initData tekshiruvi                                                 */
/* ------------------------------------------------------------------ */

/** `initData` ni maydonlarga ajratadi (takrorlangan kalitlarda — oxirgisi). */
export function parseInitData(initData: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of initData.split("&")) {
    if (part.length === 0) continue;
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = decodeURIComponent(part.slice(0, index));
    try {
      params.set(key, decodeURIComponent(part.slice(index + 1)));
    } catch {
      params.set(key, part.slice(index + 1));
    }
  }
  return params;
}

/**
 * `initData` Telegram tomonidan imzolanganini tekshiradi.
 *
 * Telegram hujjatlariga ko'ra:
 *   secret = HMAC_SHA256("WebAppData", bot_token)
 *   hash   = HMAC_SHA256(data_check_string, secret)
 * bu yerda `data_check_string` — `hash` dan tashqari barcha juftliklar,
 * alifbo tartibida, `\n` bilan birlashtirilgan.
 */
export function verifyInitData(
  initData: unknown,
  botToken: string,
  options: { now?: number; maxAgeSeconds?: number } = {},
): InitDataCheck {
  if (typeof initData !== "string" || initData.trim().length === 0) {
    return { ok: false, error: "initData bo'sh" };
  }
  if (!botToken) return { ok: false, error: "bot tokeni berilmagan" };

  const params = parseInitData(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "hash maydoni yo'q" };

  const pairs: string[] = [];
  for (const [key, value] of params) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = createHmac("sha256", secret).update(dataCheckString).digest();
  const provided = Buffer.from(hash, "hex");

  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    return { ok: false, error: "imzo mos emas" };
  }

  const authDate = Number.parseInt(params.get("auth_date") ?? "", 10);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { ok: false, error: "auth_date yo'q" };
  }

  const maxAge = options.maxAgeSeconds ?? MAX_INIT_DATA_AGE_SECONDS;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);
  if (maxAge > 0 && nowSeconds - authDate > maxAge) {
    return { ok: false, error: "initData eskirgan" };
  }

  let user: MiniAppUser | undefined;
  const rawUser = params.get("user");
  if (rawUser) {
    try {
      const parsed = JSON.parse(rawUser) as MiniAppUser;
      if (parsed && typeof parsed.id === "number") user = parsed;
    } catch {
      return { ok: false, error: "user maydoni o'qilmadi" };
    }
  }

  return { ok: true, user, authDate, chatType: params.get("chat_type") ?? undefined };
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

/** So'rov manbai (CORS ro'yxati uchun). */
export function originOf(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

/** `MINI_APP_URL` dan manba (origin) ajratib oladi: `https://d.uz/studio` → `https://d.uz`. */
export function originFromUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

async function readBody(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("so'rov juda katta");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  cors?: Record<string, string>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(cors ?? {}),
  });
  response.end(JSON.stringify(body));
}

/**
 * `POST /mini-app/send` ni boshqaradi.
 *
 * Chaqiruvchi (bot serveri) avval yo'lni tekshiradi, keyin shu funksiyani
 * chaqiradi — u javobni to'liq yozadi va hech qachon istisno tashlamaydi.
 */
export function createMiniAppHandler(
  options: MiniAppHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const log = options.log ?? ((message: string) => console.warn(message));
  const allowed = (options.allowedOrigins ?? []).filter((origin) => origin.length > 0);

  return async (request, response) => {
    const path = (request.url ?? "").split("?")[0];
    const isState = path === MINI_APP_STATE_PATH;
    const isNotebook = path === MINI_APP_NOTEBOOK_PATH;
    const isStyle = path === MINI_APP_STYLE_PATH;
    const origin = originOf(request.headers.origin);
    const originAllowed = !origin || allowed.length === 0 || allowed.includes(origin);
    const cors: Record<string, string> = originAllowed && origin
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", "vary": "origin" }
      : {};

    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...cors, "access-control-allow-methods": "POST, OPTIONS" });
      response.end();
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { ok: false, error: "faqat POST" }, cors);
      return;
    }

    let payload: {
      initData?: unknown;
      text?: unknown;
      style?: unknown;
      notebookId?: unknown;
      startLine?: unknown;
      action?: unknown;
      title?: unknown;
      sheets?: unknown;
      paper?: unknown;
      sideIndex?: unknown;
      spreadIndex?: unknown;
      wordsImage?: unknown;
      digitsImage?: unknown;
      styleId?: unknown;
      name?: unknown;
      from?: unknown;
      to?: unknown;
    };
    try {
      // Uslub so'rovida namuna suratlari keladi — chegara kattaroq.
      const raw = await readBody(request, isStyle ? MAX_STYLE_BODY_BYTES : MAX_BODY_BYTES);
      payload = JSON.parse(raw || "{}") as typeof payload;
    } catch (error) {
      sendJson(response, 400, { ok: false, error: (error as Error).message }, cors);
      return;
    }

    const check = verifyInitData(payload.initData, options.token);
    if (!check.ok) {
      log(`Mini App: initData rad etildi (${check.error})`);
      sendJson(response, 401, { ok: false, error: check.error }, cors);
      return;
    }

    // Shaxsiy chatda `user.id` — chat ID. Guruhda `chat_instance` ishlatilmaydi
    // (Mini App guruhda ochilsa ham natija foydalanuvchining shaxsiy chatiga
    // emas, so'rov egasiga qaytishi kerak — buning uchun `user.id` yetarli).
    const chatId = check.user?.id;
    if (!chatId) {
      sendJson(response, 401, { ok: false, error: "foydalanuvchi aniqlanmadi" }, cors);
      return;
    }

    const notebookId =
      typeof payload.notebookId === "string" && payload.notebookId.trim().length > 0
        ? payload.notebookId.trim()
        : undefined;
    const startLine =
      typeof payload.startLine === "number" && Number.isFinite(payload.startLine) && payload.startLine >= 1
        ? Math.floor(payload.startLine)
        : undefined;
    // Kitob ko'rinishi va betni tozalash uchun indekslar: manfiy qiymat rad etiladi.
    const spreadIndex =
      typeof payload.spreadIndex === "number" && Number.isFinite(payload.spreadIndex) && payload.spreadIndex >= 0
        ? Math.floor(payload.spreadIndex)
        : undefined;
    const sideIndex =
      typeof payload.sideIndex === "number" && Number.isFinite(payload.sideIndex) && payload.sideIndex >= 0
        ? Math.floor(payload.sideIndex)
        : undefined;
    // O'chirish oralig'i nuqtasi: bet 0 dan, qator va so'z 1 dan boshlanadi.
    const point = (raw: unknown): MiniAppPoint | undefined => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const input = raw as { side?: unknown; line?: unknown; word?: unknown };
      const side = typeof input.side === "number" ? input.side : NaN;
      const line = typeof input.line === "number" ? input.line : NaN;
      const word = typeof input.word === "number" ? input.word : NaN;
      if (!Number.isFinite(side) || !Number.isFinite(line) || !Number.isFinite(word)) return undefined;
      if (side < 0 || line < 1 || word < 1) return undefined;
      return { side: Math.floor(side), line: Math.floor(line), word: Math.floor(word) };
    };

    // Holat so'rovi: daftarlar ro'yxati va joriy bet (matn talab qilinmaydi).
    if (isState) {
      if (!options.state) {
        sendJson(response, 503, { ok: false, error: "holat xizmati yoqilmagan" }, cors);
        return;
      }
      try {
        const state = await options.state({ chatId, user: check.user, notebookId, spreadIndex });
        sendJson(response, 200, { ok: true, ...state }, cors);
      } catch (error) {
        log(`Mini App: holat so'rovida xato — ${(error as Error).message}`);
        sendJson(response, 500, { ok: false, error: "holat olinmadi" }, cors);
      }
      return;
    }

    // Shaxsiy uslub: o'lchash, yoqish, o'chirish (uslubni nusxalash).
    if (isStyle) {
      if (!options.style) {
        sendJson(response, 503, { ok: false, error: "uslub xizmati yoqilmagan" }, cors);
        return;
      }
      const action = typeof payload.action === "string" ? payload.action.trim() : "";
      if (!MINI_APP_STYLE_ACTIONS.includes(action as MiniAppStyleAction)) {
        sendJson(
          response,
          400,
          { ok: false, error: "noma'lum amal", message: "Bu amal qo'llab-quvvatlanmaydi." },
          cors,
        );
        return;
      }
      const styleId =
        typeof payload.styleId === "string" && payload.styleId.trim().length > 0
          ? payload.styleId.trim()
          : undefined;
      const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 60) : undefined;
      try {
        const result = await options.style({
          chatId,
          user: check.user,
          action: action as MiniAppStyleAction,
          ...(typeof payload.wordsImage === "string" ? { wordsImage: payload.wordsImage } : {}),
          ...(typeof payload.digitsImage === "string" ? { digitsImage: payload.digitsImage } : {}),
          ...(name ? { name } : {}),
          ...(styleId ? { styleId } : {}),
        });
        sendJson(
          response,
          result.ok ? 200 : 400,
          {
            ok: result.ok,
            message: result.message,
            styleId: result.styleId ?? null,
            name: result.name ?? null,
            baseFont: result.baseFont ?? null,
            summary: result.summary ?? null,
          },
          cors,
        );
      } catch (error) {
        log(`Mini App: uslub amalida xato — ${(error as Error).message}`);
        sendJson(
          response,
          500,
          { ok: false, error: "uslub amali bajarilmadi", message: "Uslub amali bajarilmadi — keyinroq urinib ko'ring." },
          cors,
        );
      }
      return;
    }

    // Daftar amali: yaratish, nomlash, o'chirish, orqaga qaytarish, PDF kitob.
    if (isNotebook) {
      if (!options.notebook) {
        sendJson(response, 503, { ok: false, error: "daftar xizmati yoqilmagan" }, cors);
        return;
      }

      const action = typeof payload.action === "string" ? payload.action.trim() : "";
      if (!MINI_APP_NOTEBOOK_ACTIONS.includes(action as MiniAppNotebookAction)) {
        sendJson(
          response,
          400,
          { ok: false, error: "noma'lum amal", message: "Bu amal qo'llab-quvvatlanmaydi." },
          cors,
        );
        return;
      }

      // Nomning o'zini bot tozalaydi (bo'sh nom, uzunlik, `uniqueTitle`).
      const title = typeof payload.title === "string" ? payload.title.trim().slice(0, 80) : undefined;
      try {
        const result = await options.notebook({
          chatId,
          user: check.user,
          action: action as MiniAppNotebookAction,
          notebookId,
          ...(title ? { title } : {}),
          sheets: payload.sheets,
          paper: payload.paper,
          sideIndex,
          ...(point(payload.from) ? { from: point(payload.from) } : {}),
          ...(point(payload.to) ? { to: point(payload.to) } : {}),
        });
        sendJson(
          response,
          result.ok ? 200 : 400,
          {
            ok: result.ok,
            message: result.message,
            notebookId: result.notebookId ?? null,
            title: result.title ?? null,
          },
          cors,
        );
      } catch (error) {
        log(`Mini App: daftar amalida xato — ${(error as Error).message}`);
        sendJson(
          response,
          500,
          {
            ok: false,
            error: "daftar amali bajarilmadi",
            message: "Daftar amali bajarilmadi — keyinroq urinib ko'ring.",
          },
          cors,
        );
      }
      return;
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (text.length === 0) {
      sendJson(response, 400, { ok: false, error: "matn bo'sh" }, cors);
      return;
    }
    if (text.length > MAX_MINI_APP_CHARS) {
      // Matn qisqartirilmaydi: Studio ham xuddi shu chegarani ko'rsatadi va
      // foydalanuvchi matnni bo'lib yuborishi mumkin.
      sendJson(
        response,
        400,
        {
          ok: false,
          error: "matn juda uzun",
          message: `Matn juda uzun: ${text.length} belgi, chegara — ${MAX_MINI_APP_CHARS}. Matnni bo'lib yuboring.`,
        },
        cors,
      );
      return;
    }

    try {
      const result = await options.send({
        chatId,
        user: check.user,
        text,
        style: payload.style,
        notebookId,
        startLine,
      });
      sendJson(
        response,
        200,
        {
          ok: true,
          mode: result.mode,
          pages: result.pages,
          notebook: result.notebook ?? null,
          message:
            result.mode === "notebook" && result.notebook
              ? result.line
                ? `✅ «${result.notebook}» daftariga yozildi — ${(result.side ?? 0) + 1}-betning ${result.line}-qatoridan.`
                : `✅ «${result.notebook}» daftariga yozildi — chatga yuborildi.`
              : result.pages > 1
                ? `✅ ${result.pages} varaqa chatga yuborildi.`
                : "✅ Varaqa chatga yuborildi.",
          side: result.side ?? null,
          line: result.line ?? null,
          note: result.note,
        },
        cors,
      );
    } catch (error) {
      log(`Mini App: yuborishda xato — ${(error as Error).message}`);
      sendJson(response, 500, { ok: false, error: "chatga yuborilmadi" }, cors);
    }
  };
}
