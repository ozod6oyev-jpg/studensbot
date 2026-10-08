/**
 * Telegram Mini App endpointi.
 *
 * Studio sahifasi Telegram ichida (`web_app` tugmasi orqali) ochilganda
 * `window.Telegram.WebApp.initData` satrini oladi va shu yerga yuboradi:
 *
 *   POST /mini-app/send   { initData, text, style }
 *   GET  /healthz         → "ok"
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
export const HEALTH_PATH = "/healthz";
/** `initData` shu vaqtdan eski bo'lsa qabul qilinmaydi (o'g'irlangan ma'lumot uchun). */
export const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;
/** So'rov tanasining eng katta hajmi (rasm yuborilmaydi, faqat matn). */
const MAX_BODY_BYTES = 256 * 1024;
/** Bitta so'rovda yuboriladigan eng ko'p belgi (botdagi cheklov bilan bir xil). */
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
}

export interface MiniAppResult {
  /** `pages` — alohida varaqalar, `notebook` — ochiq daftarga yozildi. */
  mode: "pages" | "notebook";
  /** Chatga yuborilgan varaqalar soni. */
  pages: number;
  /** Yozilgan daftar nomi (bo'lsa). */
  notebook?: string | null;
  /** Foydalanuvchiga ko'rsatiladigan qo'shimcha izoh. */
  note?: string;
}

export interface MiniAppHandlerOptions {
  /** Bot tokeni — `initData` imzosini tekshirish uchun. */
  token: string;
  /** Matnni chizib, chatga yuboradigan funksiya. */
  send: (request: MiniAppRequest) => Promise<MiniAppResult>;
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

    let payload: { initData?: unknown; text?: unknown; style?: unknown };
    try {
      const raw = await readBody(request);
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

    const text = typeof payload.text === "string" ? payload.text.trim().slice(0, MAX_MINI_APP_CHARS) : "";
    if (text.length === 0) {
      sendJson(response, 400, { ok: false, error: "matn bo'sh" }, cors);
      return;
    }

    try {
      const result = await options.send({
        chatId,
        user: check.user,
        text,
        style: payload.style,
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
              ? `✅ «${result.notebook}» daftariga yozildi — chatga yuborildi.`
              : result.pages > 1
                ? `✅ ${result.pages} varaqa chatga yuborildi.`
                : "✅ Varaqa chatga yuborildi.",
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
