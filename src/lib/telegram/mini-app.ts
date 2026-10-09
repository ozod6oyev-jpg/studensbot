/**
 * Telegram Mini App (WebApp) yordamchilari.
 *
 * Studio sahifasi ikki xil rejimda ishlaydi:
 *  1. oddiy brauzerda — natija faqat shu yerda ko'rinadi va yuklab olinadi;
 *  2. Telegram ichida (Mini App) — natijani `initData` bilan botga yuborib,
 *     to'g'ridan-to'g'ri chatga qaytarish mumkin.
 *
 * Bu fayl SDK'ga bog'liq emas: Telegram skripti (`telegram-web-app.js`) sahifa
 * ochilganda `window.Telegram.WebApp` ni o'zi yaratadi. Skript ulanmagan bo'lsa
 * (oddiy brauzer), hamma funksiya xavfsiz `null`/`false` qaytaradi.
 */
import type { NotebookStyle, PaperType } from "@/lib/handwriting/types";

/* ------------------------------------------------------------------ */
/* SDK tiplari (kerakli qismi)                                          */
/* ------------------------------------------------------------------ */

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface TelegramInitDataUnsafe {
  query_id?: string;
  user?: TelegramWebAppUser;
  auth_date?: number;
  hash?: string;
}

export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
}

export interface TelegramHapticFeedback {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
  selectionChanged(): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: TelegramThemeParams;
  viewportHeight?: number;
  isExpanded?: boolean;
  ready(): void;
  expand(): void;
  close(): void;
  openLink?(url: string): void;
  showAlert?(message: string, callback?: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: string, handler: () => void): void;
  HapticFeedback?: TelegramHapticFeedback;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/* ------------------------------------------------------------------ */
/* Aniqlash                                                             */
/* ------------------------------------------------------------------ */

/** Telegram WebApp obyekti (Mini App ichida bo'lmasa `null`). */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/**
 * Sahifa Telegram Mini App sifatida ochilganmi.
 *
 * Faqat `initData` mavjud bo'lsa `true`: aynan shu satr botga yuboriladi va
 * bot uni token bilan tekshirib, chat ID'ni aniqlaydi.
 */
export function isMiniApp(): boolean {
  const app = getTelegramWebApp();
  return typeof app?.initData === "string" && app.initData.length > 0;
}

/** Mini App ichidagi foydalanuvchi ismi (faqat ko'rsatish uchun). */
export function miniAppUserName(): string | null {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return full || user.username || null;
}

/* ------------------------------------------------------------------ */
/* Chatga yuborish                                                      */
/* ------------------------------------------------------------------ */

/**
 * Botning Mini App manzili. Sahifa va bot odatda bitta domenda turadi
 * (nginx `/mini-app/` yo'lini bot portiga proxy qiladi), shuning uchun
 * standart qiymat — nisbiy yo'l. Boshqa domendagi bot uchun:
 * `VITE_MINI_APP_ENDPOINT=https://bot.example.com/mini-app/send`
 */
export const MINI_APP_ENDPOINT =
  (import.meta.env.VITE_MINI_APP_ENDPOINT as string | undefined)?.trim() || "/mini-app/send";

/**
 * Holat so'rovi manzili: chatdagi daftarlar ro'yxati va tanlangan daftarning
 * joriy yozish joyi. Boshqa domendagi bot uchun:
 * `VITE_MINI_APP_STATE_ENDPOINT=https://bot.example.com/mini-app/state`
 */
export const MINI_APP_STATE_ENDPOINT =
  (import.meta.env.VITE_MINI_APP_STATE_ENDPOINT as string | undefined)?.trim() ||
  "/mini-app/state";

/**
 * Daftar amallari manzili (yaratish, nomlash, o'chirish, orqaga qaytarish,
 * PDF kitob). Boshqa domendagi bot uchun:
 * `VITE_MINI_APP_NOTEBOOK_ENDPOINT=https://bot.example.com/mini-app/notebook`
 */
export const MINI_APP_NOTEBOOK_ENDPOINT =
  (import.meta.env.VITE_MINI_APP_NOTEBOOK_ENDPOINT as string | undefined)?.trim() ||
  "/mini-app/notebook";

export interface MiniAppSendPayload {
  /** Daftarga yoziladigan matn. */
  text: string;
  /** Studio'dagi sozlamalar — bot ularni saqlab, o'sha uslubda yozadi. */
  style?: Partial<NotebookStyle>;
  /** Qaysi daftarga yozish (bo'lmasa — botdagi ochiq daftar). */
  notebookId?: string;
  /** Nechanchi qatordan yozish (1 dan boshlab). */
  startLine?: number;
}

/* ------------------------------------------------------------------ */
/* Daftarlar va yozish joyi (Mini App'da tanlash uchun)                 */
/* ------------------------------------------------------------------ */

/** Mini App'dan chaqiriladigan daftar amali (botdagi tugmalar bilan bir xil). */
export type MiniAppNotebookAction = "create" | "rename" | "remove" | "undo" | "book";

/** `manageNotebook()` uchun so'rov: amal va unga kerakli maydonlar. */
export interface MiniAppNotebookPayload {
  action: MiniAppNotebookAction;
  /** Qaysi daftar ustida ish bajariladi (`create` uchun shart emas). */
  notebookId?: string;
  /** Yangi nom (`create`/`rename`). */
  title?: string;
  /** Yangi daftar varaqlari soni (`create`): 12/36/48/96. */
  sheets?: number;
  /** Yangi daftar qog'ozi (`create`): `lined`/`grid`/`plain`. */
  paper?: PaperType;
}

export interface MiniAppNotebookResult {
  ok: boolean;
  /** Foydalanuvchiga ko'rsatiladigan qisqa xabar (xato bo'lsa ham shu). */
  message: string;
  /** Yaratilgan/o'zgargan daftar id'si — uni tanlab qo'yish uchun. */
  notebookId?: string | null;
  title?: string | null;
}

/** Chatdagi bitta daftar — Mini App ro'yxati uchun qisqa ko'rinish. */
export interface MiniAppNotebook {
  id: string;
  title: string;
  /** Varaq soni (12/36/48/96). */
  sheets: number;
  paper: PaperType;
  /** Band qilingan betlar soni. */
  usedSides: number;
  /** Jami betlar soni (`sheets * 2`). */
  capacity: number;
  /** Botda ochiq (faol) daftarmi. */
  active: boolean;
}

/**
 * Tanlangan daftarning joriy beti: shu betdan keyingi yozuv davom etadi.
 * `text` — betdagi mavjud matn (Studio uni chizib ko'rsatadi), `nextLine` esa
 * taklif qilinadigan boshlanish qatori (1 dan boshlab).
 */
export interface MiniAppSide {
  sideIndex: number;
  sideCount: number;
  text: string;
  linesPerPage: number;
  usedLines: number;
  nextLine: number;
  freeLines: number;
}

export interface MiniAppState {
  notebooks: MiniAppNotebook[];
  activeId: string | null;
  side: MiniAppSide | null;
  style: Partial<NotebookStyle>;
}

export interface MiniAppStateResult {
  ok: boolean;
  state?: MiniAppState;
  /** Foydalanuvchiga ko'rsatiladigan qisqa xabar (xato bo'lsa). */
  message?: string;
}

export interface MiniAppSendResult {
  ok: boolean;
  /** `pages` — alohida varaqalar yuborildi, `notebook` — ochiq daftarga yozildi. */
  mode?: "pages" | "notebook";
  pages?: number;
  notebook?: string | null;
  /** Foydalanuvchiga ko'rsatiladigan qisqa xabar. */
  message: string;
}

const SEND_TIMEOUT_MS = 90_000;
/** Holat so'rovi tez bo'lishi kerak: daftar ro'yxati darhol ko'rinadi. */
const STATE_TIMEOUT_MS = 15_000;
/** Daftar amali (PDF kitob ham shu yo'ldan ketadi — chizish uzoq davom etadi). */
const NOTEBOOK_TIMEOUT_MS = 180_000;

/** Chatga yuborish natijasini o'qiladigan xabarga aylantiradi. */
function describeResult(payload: {
  mode?: "pages" | "notebook";
  pages?: number;
  notebook?: string | null;
}): string {
  if (payload.mode === "notebook" && payload.notebook) {
    return `✅ «${payload.notebook}» daftariga yozildi — chatga yuborildi.`;
  }
  if (payload.mode === "notebook") return "✅ Chatdagi ochiq daftarga yozildi.";
  const pages = payload.pages ?? 0;
  return pages > 1 ? `✅ ${pages} varaqa chatga yuborildi.` : "✅ Varaqa chatga yuborildi.";
}

/**
 * Studiodagi matn va sozlamalarni botga yuboradi; bot ularni tekshirib
 * (`initData`), o'sha chatda daftar varaqasini chizib qaytaradi.
 *
 * Xatolar ham natija sifatida qaytariladi — UI'ni yiqitmasligi uchun.
 */
export async function sendToChat(payload: MiniAppSendPayload): Promise<MiniAppSendResult> {
  const app = getTelegramWebApp();
  const initData = app?.initData ?? "";

  if (!initData) {
    return {
      ok: false,
      message:
        "Bu tugma faqat Telegram ichida ishlaydi. Botni ochib, menyudagi «Studio» tugmasi bilan kiring.",
    };
  }

  const text = payload.text.trim();
  if (text.length === 0) {
    return { ok: false, message: "Avval matn yozing — bot uni daftarga ko'chirib beradi." };
  }

  let response: Response;
  try {
    response = await fetch(MINI_APP_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData,
        text,
        style: payload.style ?? {},
        ...(payload.notebookId ? { notebookId: payload.notebookId } : {}),
        ...(payload.startLine ? { startLine: payload.startLine } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      message: "Bot serveriga ulanib bo'lmadi. Internetni tekshirib, qaytadan urinib ko'ring.",
    };
  }

  let body: (Partial<MiniAppSendResult> & { error?: string }) | null = null;
  try {
    body = (await response.json()) as Partial<MiniAppSendResult> & { error?: string };
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok !== true) {
    const detail = body?.message ?? body?.error;
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: "Telegram ma'lumotlari eskirgan. Mini App'ni yopib, botdan qaytadan oching.",
      };
    }
    return { ok: false, message: detail ?? `Yuborilmadi (HTTP ${response.status}).` };
  }

  return {
    ok: true,
    mode: body.mode,
    pages: body.pages,
    notebook: body.notebook,
    message: body.message ?? describeResult(body),
  };
}

/**
 * Chatdagi daftarlar ro'yxatini va tanlangan daftarning joriy joyini so'raydi.
 *
 * `notebookId` berilsa, bot o'sha daftarni ochiq (faol) qilib belgilaydi va
 * uning joriy beti haqida ma'lumot qaytaradi — Studio shu asosda «qaysi
 * qatordan yozamiz?» tanlovini daftar varaqasining o'zida ko'rsatadi.
 *
 * Xatolar ham natija sifatida qaytariladi — UI'ni yiqitmasligi uchun.
 */
export async function fetchNotebookState(notebookId?: string | null): Promise<MiniAppStateResult> {
  const app = getTelegramWebApp();
  const initData = app?.initData ?? "";

  if (!initData) {
    return {
      ok: false,
      message:
        "Daftarlar ro'yxati faqat Telegram ichida ko'rinadi — bot menyusidagi «Studio» tugmasi bilan kiring.",
    };
  }

  let response: Response;
  try {
    response = await fetch(MINI_APP_STATE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...(notebookId ? { notebookId } : {}) }),
      signal: AbortSignal.timeout(STATE_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      message: "Bot serveriga ulanib bo'lmadi. Internetni tekshirib, qaytadan urinib ko'ring.",
    };
  }

  type StateBody = Partial<MiniAppState> & { ok?: boolean; error?: string; message?: string };
  let body: StateBody | null = null;
  try {
    body = (await response.json()) as StateBody;
  } catch {
    body = null;
  }

  if (!response.ok || body?.ok !== true) {
    const detail = body?.message ?? body?.error;
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: "Telegram ma'lumotlari eskirgan. Mini App'ni yopib, botdan qaytadan oching.",
      };
    }
    return { ok: false, message: detail ?? `Daftarlar ro'yxati olinmadi (HTTP ${response.status}).` };
  }

  const notebooks = body?.notebooks;
  return {
    ok: true,
    state: {
      notebooks: Array.isArray(notebooks) ? notebooks : [],
      activeId: typeof body?.activeId === "string" ? body.activeId : null,
      side: body?.side ?? null,
      style: body?.style ?? {},
    },
  };
}

/**
 * Chatdagi daftar bilan amal bajaradi: yangi daftar yaratish, nomini
 * almashtirish, o'chirish, oxirgi tahrirni orqaga qaytarish yoki yozilgan
 * betlarni PDF kitob qilib chatga yuborish.
 *
 * Botga faqat `initData` ishonchli ma'lumot; `notebookId` esa tekshiriladi —
 * begona chatning daftari ustida amal bajarilmaydi. Xatolar ham natija
 * sifatida qaytariladi, shuning uchun UI yiqilmaydi.
 */
export async function manageNotebook(
  payload: MiniAppNotebookPayload,
): Promise<MiniAppNotebookResult> {
  const app = getTelegramWebApp();
  const initData = app?.initData ?? "";

  if (!initData) {
    return {
      ok: false,
      message: "Bu tugmalar faqat Telegram ichida ishlaydi. Bot menyusidagi «Studio» tugmasi bilan kiring.",
    };
  }

  let response: Response;
  try {
    response = await fetch(MINI_APP_NOTEBOOK_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData,
        action: payload.action,
        ...(payload.notebookId ? { notebookId: payload.notebookId } : {}),
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.sheets ? { sheets: payload.sheets } : {}),
        ...(payload.paper ? { paper: payload.paper } : {}),
      }),
      signal: AbortSignal.timeout(NOTEBOOK_TIMEOUT_MS),
    });
  } catch {
    return {
      ok: false,
      message: "Bot serveriga ulanib bo'lmadi. Internetni tekshirib, qaytadan urinib ko'ring.",
    };
  }

  let body: (Partial<MiniAppNotebookResult> & { error?: string }) | null = null;
  try {
    body = (await response.json()) as Partial<MiniAppNotebookResult> & { error?: string };
  } catch {
    body = null;
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      message: "Telegram ma'lumotlari eskirgan. Mini App'ni yopib, botdan qaytadan oching.",
    };
  }
  if (!response.ok || body?.ok !== true) {
    return {
      ok: false,
      message: body?.message ?? body?.error ?? `Amal bajarilmadi (HTTP ${response.status}).`,
    };
  }

  return {
    ok: true,
    message: body.message ?? "✅ Bajarildi.",
    notebookId: body.notebookId ?? null,
    title: body.title ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Kichik Telegram yordamchilari                                        */
/* ------------------------------------------------------------------ */

/** Native ko'rinish uchun qisqa tebranish (qo'llab-quvvatlanmasa jim o'tadi). */
export function haptic(kind: "success" | "error" | "tap" = "tap"): void {
  const feedback = getTelegramWebApp()?.HapticFeedback;
  if (!feedback) return;
  try {
    if (kind === "tap") feedback.impactOccurred("light");
    else feedback.notificationOccurred(kind);
  } catch {
    // Eski Telegram versiyalarida jim o'tamiz.
  }
}

/** Telegram oynasi ichida ogohlantirish; brauzerda oddiy `alert`. */
export function notify(message: string): void {
  const showAlert = getTelegramWebApp()?.showAlert;
  if (showAlert) {
    showAlert(message);
    return;
  }
  if (typeof window !== "undefined") window.alert(message);
}
