/**
 * Daftar Bot — Telegram bot runtime.
 *
 * Foydalanuvchi matn yuboradi → bot uni daftar varaqasiga qo'lda yozilgan
 * ko'rinishda rasm qilib qaytaradi.
 *
 * Interfeys pastdagi doimiy (reply) menyuda: tugmalar chat ichida emas, ekran
 * tubida turadi. Asosiy menyu: `✍️ Matn kiritish` va `⚙️ Sozlamalar`; sozlamalar
 * ichida siyoh rangi (10 xil), qog'oz turi (3 xil), yozuv uslubi (39 shrift,
 * rasm ko'rinishida), yozuv sozlamalari va daftarlar.
 *
 * Yozilgan matn "daftar bazasi"ga (`notebooks.json`) tushadi: har bir daftar
 * 12/36/48/96 varaqdan iborat, varaqning old tomonida chegara chapda, orqa
 * tomonida — o'ngda (xuddi haqiqiy daftar kabi).
 *
 * `📚 Daftarlar` bo'limida har bir daftar uchun karta bor: daftarga yozish,
 * uni **kitob (PDF) qilib yuklab olish**, nomini o'zgartirish. Yangi daftarga
 * varaq soni tanlangach nom ham beriladi (nomsiz qoldirilsa `N-daftar`).
 *
 * Ishga tushirish:
 *   bun bot/index.ts                 # long polling (eng oddiy usul)
 *   bun bot/index.ts poll
 *   bun bot/index.ts webhook https://mening-botim.example.com
 *   bun bot/index.ts info
 *   bun bot/index.ts delete-webhook
 *
 * Env: TELEGRAM_BOT_TOKEN (majburiy), BOT_SECRET (ixtiyoriy), PORT (webhook uchun),
 *      BOT_DATA_DIR (standart: ./bot/data), TELEGRAM_API_BASE (o'z Bot API serveri).
 */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderNotebook } from "../src/lib/handwriting/render";
import { renderFontSheet } from "../src/lib/handwriting/font-sheet";
import { renderNotebookPdf, slugifyTitle } from "../src/lib/handwriting/notebook-pdf";
import { fitToSingleSide } from "../src/lib/handwriting/fit";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";
import { INK_OPTIONS, PAPER_OPTIONS, categoryLabel, fontSupportsCyrillic } from "../src/lib/handwriting/options";
import { fontDisplayName, fontSummary } from "../src/lib/handwriting/names";
import { cleanTitle, createStore, type Notebook, type NotebookSheets, type NotebookStore } from "./db";
import {
  DEFAULT_STYLE,
  type FontId,
  type InkColor,
  type NotebookStyle,
  type PageSide,
  type PaperType,
} from "../src/lib/handwriting/types";

/* ------------------------------------------------------------------ */
/* Tiplar                                                              */
/* ------------------------------------------------------------------ */

interface TgChat {
  id: number;
  type: string;
  first_name?: string;
  title?: string;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
  from?: { id: number; first_name?: string };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Pastdagi doimiy klaviatura (reply keyboard). */
interface TgReplyKeyboard {
  keyboard: { text: string }[][];
  resize_keyboard: boolean;
  is_persistent: boolean;
  input_field_placeholder?: string;
}

type TgMarkup = TgReplyKeyboard;

/** Botning ochiq menyulari. */
type MenuId =
  | "main"
  | "settings"
  | "ink"
  | "paper"
  | "fonts"
  | "writing"
  | "size"
  | "wobble"
  | "gap"
  | "math"
  | "send"
  | "books"
  | "newbook";

/** Bot matn kutayotgan holat: daftarga nom berish yoki nomini o'zgartirish. */
type PendingInput =
  | { kind: "create"; sheets: NotebookSheets }
  | { kind: "rename"; id: string };

/** Har bir chat uchun saqlanadigan sozlamalar. */
type ChatSettings = Partial<NotebookStyle> & {
  asFile?: boolean;
  /** Hozir ko'rsatilgan menyu (tugmalar shunga mos). */
  menu?: MenuId;
  /** Shrift varaqasi sahifasi (0 dan boshlanadi). */
  fontPage?: number;
  /** Ochiq daftar id'si. */
  notebookId?: string;
  /** Bot matn kutayotgan bo'lsa (nom kiritish uchun). */
  pending?: PendingInput;
  /** Ochiq daftar kartasi — karta tugmalari shu daftarga tegishli. */
  cardId?: string;
  /** Daftar tugmasi matni → daftar id (nomlar bir xil bo'lishi mumkin). */
  bookButtons?: Record<string, string>;
  /** `📚 Daftarlar` ro'yxatida daftar bosilganda nima bo'ladi. */
  booksAction?: "write" | "manage";
};
type SettingsMap = Record<string, ChatSettings>;
/** Chizish uchun yuklangan shrift baytlari (kalit — shrift id'si). */
type FontBytes = Record<string, Uint8Array>;

/* ------------------------------------------------------------------ */
/* Konstantalar                                                        */
/* ------------------------------------------------------------------ */

/** Pastdagi menyu tugmalarining matnlari (routing shu matnlar bo'yicha). */
const L = {
  text: "✍️ Matn kiritish",
  settings: "⚙️ Sozlamalar",
  ink: "🖋 Siyoh rangi",
  paper: "📄 Qog'oz turi",
  font: "✍️ Yozuv uslubi",
  writing: "📐 Yozuv sozlamalari",
  books: "📚 Daftarlar",
  newBook: "➕ Yangi daftar",
  backMain: "⬅️ Asosiy menyu",
  backSettings: "⬅️ Sozlamalar",
  backWriting: "⬅️ Yozuv sozlamalari",
  backBooks: "⬅️ Daftarlar",
  backFonts: "⬅️ Yozuv uslubi",
  prevPage: "⬅️ Oldingi",
  nextPage: "Keyingi ➡️",
  sizeMenu: "🔠 O'lcham",
  wobbleMenu: "〰️ Qo'l tebranishi",
  gapMenu: "📏 Qator oralig'i",
  mathMenu: "🔢 Matematika",
  sendMenu: "🖼 Yuborish turi",
  cardWrite: "✍️ Shu daftarga yozish",
  cardDownload: "⬇️ PDF yuklab olish",
  cardRename: "✏️ Nomini o'zgartirish",
  skipName: "⏭ Nomsiz qoldirish",
} as const;

const PAPER_LABEL: Record<PaperType, string> = {
  lined: "yo'l-yo'l daftar",
  grid: "katak daftar",
  plain: "toza (A4) varaq",
};

/** Qog'oz menyusidagi tugma matnlari. */
const PAPER_SHORT: Record<PaperType, string> = {
  lined: "Yo'l-yo'l",
  grid: "Katak",
  plain: "Toza (A4)",
};

const INK_IDS: InkColor[] = INK_OPTIONS.map((option) => option.id);
const INK_LABEL = Object.fromEntries(INK_OPTIONS.map((option) => [option.id, option.label])) as Record<
  InkColor,
  string
>;
const INK_HEX = Object.fromEntries(INK_OPTIONS.map((option) => [option.id, option.hex])) as Record<
  InkColor,
  string
>;
/** Tugmalar uchun qisqa siyoh nomi: "Ko'k ruchka" → "Ko'k". */
const INK_BUTTON = Object.fromEntries(
  INK_OPTIONS.map((option) => [option.id, option.label.replace(/ ruchka$/, "")]),
) as Record<InkColor, string>;

const PAPER_IDS: PaperType[] = PAPER_OPTIONS.map((option) => option.id);

/** Eng ko'p ishlatiladigan shriftlar uchun qisqa buyruqlar. */
const QUICK_FONTS: Record<string, FontId> = {
  "/caveat": "caveat",
  "/marck": "marckscript",
};

/** Yozuv o'lchami variantlari. */
const SIZE_OPTIONS = [26, 30, 34, 38, 42, 46, 52];

/** Qo'l tebranishi (wobble) darajalari. */
const WOBBLE_OPTIONS: { label: string; value: number }[] = [
  { label: "Tekis", value: 0.25 },
  { label: "O'rtacha", value: 0.55 },
  { label: "Jonli", value: 0.85 },
];

/** Qator oralig'i (shrift o'lchamiga nisbatan koeffitsient). */
const GAP_OPTIONS: { label: string; ratio: number }[] = [
  { label: "Zich", ratio: 1.45 },
  { label: "O'rtacha", ratio: 1.65 },
  { label: "Keng", ratio: 1.9 },
];

const MATH_ON = "🔢 Matematika: yoniq";
const MATH_OFF = "🔢 Matematika: o'chiq";
const SEND_PHOTO = "🖼 Rasm sifatida";
const SEND_FILE = "📄 PNG fayl sifatida";

/** Varaqani tanlash tugmalari: "12 varaq" va h.k. */
const SHEET_BUTTONS: { text: string; sheets: NotebookSheets }[] = [
  { text: "12 varaq", sheets: 12 },
  { text: "36 varaq", sheets: 36 },
  { text: "48 varaq", sheets: 48 },
  { text: "96 varaq", sheets: 96 },
];

/** Shrift varaqasidagi qatorlar soni (bir sahifadagi shrift soni). */
const FONT_PAGE_SIZE = 8;
const FONT_PAGE_COUNT = Math.max(1, Math.ceil(FONT_LIBRARY.length / FONT_PAGE_SIZE));

const ALLOWED_UPDATES = ["message"];
/** Bitta xabardan ko'pi bilan shuncha tomon yoziladi (Telegram chegaralari uchun). */
const MAX_SIDES_PER_MESSAGE = 12;
/** Bitta tomon uchun ko'pi bilan shuncha varaqa rasmi yuboriladi. */
const MAX_RENDER_PAGES = 4;
/** Bitta xabarda qabul qilinadigan eng ko'p belgi. */
const MAX_CHARS = 4000;
const SIZE_MIN = SIZE_OPTIONS[0];
const SIZE_MAX = SIZE_OPTIONS[SIZE_OPTIONS.length - 1];
/** PDF qismining eng katta hajmi (Telegram bitta faylga ~50 MB qo'yadi). */
const PDF_VOLUME_BYTES = 18 * 1024 * 1024;
/** Jarayon xabari necha betdan keyin yangilanadi. */
const PDF_PROGRESS_STEP = 8;
const WEBHOOK_PATH = "/telegram/webhook";
const CYRILLIC_RE = /[\u0400-\u04FF]/;

const HELP_TEXT = [
  "📓 Daftar Bot — matningizni haqiqiy daftar varaqasidek qo'lda yozib beraman.",
  "",
  "Pastdagi menyudan foydalaning:",
  `• ${L.text} — yozishni boshlash (daftar tanlanadi)`,
  `• ${L.settings} — siyoh rangi, qog'oz turi, yozuv uslubi va boshqa sozlamalar`,
  "",
  "Buyruqlar:",
  "/start — menyuni ko'rsatish",
  "/settings — sozlamalar menyusi",
  "/id — chat ID'ni ko'rsatadi",
  "/fonts — shriftlar kutubxonasi (rasm ko'rinishida)",
  "/font <id> — shriftni tanlash (masalan /font badscript)",
  `/size ${SIZE_MIN}..${SIZE_MAX} — shrift o'lchami`,
  "/file — natijani PNG fayl qilib yuborish",
  ...INK_IDS.map((id) => `/${id}`).join(" ") + " — siyoh rangi",
  PAPER_IDS.map((id) => `/${id}`).join(" ") + " — qog'oz turi",
  "/help — shu yordam",
  "",
  "Daftarlar: ➕ Yangi daftar (12/36/48/96 varaq) — varaq sonini tanlagach nom ham",
  "beriladi. Yozgan matningiz varaq-tomonga ketma-ket tushadi: old tomonda chegara",
  "chapda, orqa tomonda — o'ngda.",
  "📚 Daftarlar bo'limida har bir daftar kartasi bor: yozish, kitob (PDF) qilib",
  "yuklab olish va nomini o'zgartirish.",
  "",
  "Matematika yozuvi:",
  "• daraja: x^2, x^{10}",
  "• indeks: a_1, a_{n+1}",
  "• kasr: \\frac{a}{b} yoki $a/b$",
  "• ildiz: \\sqrt{x} yoki √x",
  "• belgilar: × ÷ ± ≤ ≥ ≠ ∞ π ∑ ∫ √ ° ∠ ⊥ ∈ ∪ ∩",
].join("\n");

/* ------------------------------------------------------------------ */
/* Sozlamalar ombori (JSON fayl)                                       */
/* ------------------------------------------------------------------ */

const DATA_DIR = process.env.BOT_DATA_DIR?.trim() || join(process.cwd(), "bot", "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

let settingsCache: SettingsMap = {};
let notebookStore: NotebookStore | null = null;

/** Daftar bazasi (bir marta ochiladi). */
async function books(): Promise<NotebookStore> {
  if (!notebookStore) notebookStore = await createStore(DATA_DIR);
  return notebookStore;
}

/** Fayldan sozlamalarni o'qiydi; fayl yo'q yoki buzilgan bo'lsa bo'sh obyekt qaytaradi. */
async function loadSettings(): Promise<SettingsMap> {
  try {
    const raw = await readFile(SETTINGS_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SettingsMap;
    }
    console.warn("settings.json formati kutilganidek emas — bo'sh sozlamalar ishlatiladi");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      console.warn("settings.json o'qilmadi:", (error as Error).message);
    }
  }
  return {};
}

/** Sozlamalarni avval vaqtinchalik faylga yozib, keyin nomini almashtiradi (atomar yozish). */
async function saveSettings(all: SettingsMap): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
    await rename(tmp, SETTINGS_FILE);
  } catch (error) {
    console.warn("settings.json saqlanmadi:", (error as Error).message);
  }
}

/** Chat sozlamalarini yangilaydi va keshni qaytaradi. */
async function updateSettings(chatId: number, patch: ChatSettings): Promise<ChatSettings> {
  const key = String(chatId);
  settingsCache = { ...settingsCache, [key]: { ...settingsCache[key], ...patch } };
  await saveSettings(settingsCache);
  return settingsCache[key];
}

function rawSettings(chatId: number): ChatSettings {
  return settingsCache[String(chatId)] ?? {};
}

/** Chat sozlamalaridan to'liq uslub obyektini yig'adi (standart qiymatlar bilan). */
function styleFor(chatId: number): NotebookStyle {
  const chat = rawSettings(chatId);
  // Kutubxonada yo'q shrift saqlanib qolgan bo'lsa (masalan, yangilanishdan keyin),
  // standart shriftga qaytamiz.
  const font = chat.font && fontEntry(chat.font) ? chat.font : DEFAULT_STYLE.font;
  return {
    ...DEFAULT_STYLE,
    ...chat,
    font,
    seed: (DEFAULT_STYLE.seed + Math.abs(chatId)) % 9973,
  };
}

function isFileMode(chatId: number): boolean {
  return rawSettings(chatId).asFile === true;
}

function currentMenu(chatId: number): MenuId {
  return rawSettings(chatId).menu ?? "main";
}

function fontPageOf(chatId: number): number {
  const page = rawSettings(chatId).fontPage ?? 0;
  return Math.min(FONT_PAGE_COUNT - 1, Math.max(0, page));
}

/** Shriftning ko'rsatiladigan nomi (`names.ts` dagi umumiy yordamchi). */
const displayName = fontDisplayName;

/* ------------------------------------------------------------------ */
/* Telegram API yordamchilari                                          */
/* ------------------------------------------------------------------ */

/**
 * API manzili. Standart — rasmiy Telegram serveri; o'z Bot API serveringiz
 * (yoki test uchun mahalliy mock server) bo'lsa TELEGRAM_API_BASE orqali
 * almashtiriladi: TELEGRAM_API_BASE=http://127.0.0.1:8081
 */
function apiBase(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN o'rnatilmagan");
  const root = process.env.TELEGRAM_API_BASE?.trim().replace(/\/+$/, "") || "https://api.telegram.org";
  return `${root}/bot${token}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Bitta API so'rovi: 429 (rate limit) bo'lsa bir marta kutib qayta urinadi. */
async function tgRequest<T>(method: string, init: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${apiBase()}/${method}`, init);
    let payload: TgApiResponse<T> | undefined;
    try {
      payload = (await response.json()) as TgApiResponse<T>;
    } catch {
      payload = undefined;
    }
    if (payload?.ok) return payload.result as T;

    const retryAfter = payload?.parameters?.retry_after;
    if (response.status === 429 && retryAfter && attempt < 1) {
      console.warn(`Telegram 429: ${retryAfter}s kutamiz (${method})`);
      await sleep((retryAfter + 1) * 1000);
      continue;
    }
    throw new Error(`${method}: ${payload?.description ?? `HTTP ${response.status}`}`);
  }
}

/** JSON so'rov yuboradi. */
function tg<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  return tgRequest<T>(method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Matn yuboradi (ixtiyoriy pastki klaviatura bilan). Xabar id'sini qaytaradi. */
async function sendMessage(chatId: number, text: string, markup?: TgMarkup): Promise<number | undefined> {
  const result = await tg<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(markup ? { reply_markup: markup } : {}),
  });
  return result?.message_id;
}

/**
 * Mavjud xabar matnini yangilaydi (masalan, PDF tayyorlash jarayoni). Xato
 * bo'lsa jim o'tadi — bu shunchaki ko'rsatkich, asosiy ishni to'xtatmaydi.
 */
async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  try {
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text });
  } catch (error) {
    console.warn("editMessageText bajarilmadi:", (error as Error).message);
  }
}

/** PNG'ni rasm (yoki fayl) sifatida yuboradi. */
async function sendPng(
  chatId: number,
  png: Uint8Array,
  options: { asFile: boolean; filename: string; caption?: string; markup?: TgMarkup },
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (options.caption) form.append("caption", options.caption.slice(0, 1000));
  if (options.markup) form.append("reply_markup", JSON.stringify(options.markup));

  // PNG baytlarini alohida ArrayBuffer'ga ko'chirib, Blob yasaymiz
  // (Buffer ko'rinishidagi baytlar ham xavfsiz yuborilishi uchun).
  const buffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "image/png" });
  if (options.asFile) {
    form.append("document", blob, options.filename);
    await tgRequest("sendDocument", { method: "POST", body: form });
  } else {
    form.append("photo", blob, options.filename);
    await tgRequest("sendPhoto", { method: "POST", body: form });
  }
}

/** Ixtiyoriy fayl (masalan, PDF kitob) yuboradi. */
async function sendDocumentFile(
  chatId: number,
  bytes: Uint8Array,
  options: { filename: string; mime: string; caption?: string; markup?: TgMarkup },
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (options.caption) form.append("caption", options.caption.slice(0, 1000));
  if (options.markup) form.append("reply_markup", JSON.stringify(options.markup));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append("document", new Blob([buffer], { type: options.mime }), options.filename);
  await tgRequest("sendDocument", { method: "POST", body: form });
}

/* ------------------------------------------------------------------ */
/* Shriftlarni yuklash (lazy + kesh)                                   */
/* ------------------------------------------------------------------ */

const fontCache = new Map<FontId, Promise<Uint8Array | null>>();

/** Bitta shriftni fayldan o'qiydi (natija keshda saqlanadi). */
function loadFont(id: FontId): Promise<Uint8Array | null> {
  const cached = fontCache.get(id);
  if (cached) return cached;

  const promise = (async (): Promise<Uint8Array | null> => {
    const entry = fontEntry(id);
    if (!entry) {
      console.warn(`Shrift kutubxonada topilmadi: ${id}`);
      return null;
    }
    try {
      const bytes = await readFile(new URL(`../src/assets/fonts/${entry.file}`, import.meta.url));
      return new Uint8Array(bytes);
    } catch (error) {
      console.warn(`"${id}" shrifti o'qilmadi:`, (error as Error).message);
      return null;
    }
  })();

  fontCache.set(id, promise);
  return promise;
}

/** Berilgan shrift id'larini (takrorlarsiz) yuklaydi. */
async function loadFonts(ids: FontId[]): Promise<FontBytes> {
  const unique = ids.filter((id, index, list) => list.indexOf(id) === index);
  const loaded = await Promise.all(unique.map((id) => loadFont(id)));

  const fonts: FontBytes = {};
  unique.forEach((id, index) => {
    const bytes = loaded[index];
    if (bytes) fonts[id] = bytes;
  });
  return fonts;
}

/**
 * Berilgan uslub uchun zarur shriftlarni yuklaydi: tanlangan shrift va
 * (yetim belgilar uchun) zaxira shrift. Kutubxonaning qolgan shriftlari
 * tarmoqqa ham, xotiraga ham tegmaydi.
 */
function fontsFor(style: NotebookStyle): Promise<FontBytes> {
  return loadFonts([style.font, FALLBACK_FONT_ID]);
}

/* ------------------------------------------------------------------ */
/* Menyu klaviaturalari                                                */
/* ------------------------------------------------------------------ */

/** Pastdagi klaviaturani yasaydi (tugmalar matni bilan). */
function reply(rows: string[][]): TgMarkup {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Joriy qiymatni ✓ bilan belgilaydi. */
function mark(active: boolean, label: string): string {
  return `${active ? "✓ " : ""}${label}`;
}

/** Tugma matnidan ✓ belgisini olib tashlaydi. */
function unmark(label: string): string {
  return label.replace(/^✓\s*/, "");
}

function mainKeyboard(): TgMarkup {
  return reply([[L.text, L.settings]]);
}

function settingsKeyboard(): TgMarkup {
  return reply([
    [L.ink, L.paper],
    [L.font, L.writing],
    [L.books, L.backMain],
  ]);
}

function inkKeyboard(style: NotebookStyle): TgMarkup {
  const rows: string[][] = [];
  for (let index = 0; index < INK_IDS.length; index += 2) {
    rows.push(
      INK_IDS.slice(index, index + 2).map((id) => mark(style.ink === id, INK_BUTTON[id])),
    );
  }
  rows.push([L.backSettings]);
  return reply(rows);
}

function paperKeyboard(style: NotebookStyle): TgMarkup {
  return reply([
    PAPER_IDS.map((id) => mark(style.paper === id, PAPER_SHORT[id])),
    [L.backSettings],
  ]);
}

function writingKeyboard(): TgMarkup {
  return reply([[L.sizeMenu, L.wobbleMenu], [L.gapMenu, L.mathMenu], [L.sendMenu], [L.backSettings]]);
}

function sizeKeyboard(style: NotebookStyle): TgMarkup {
  const rows: string[][] = [];
  for (let index = 0; index < SIZE_OPTIONS.length; index += 4) {
    rows.push(SIZE_OPTIONS.slice(index, index + 4).map((size) => mark(style.fontSize === size, String(size))));
  }
  rows.push([L.backWriting]);
  return reply(rows);
}

function wobbleKeyboard(style: NotebookStyle): TgMarkup {
  const rows = [
    WOBBLE_OPTIONS.map((option) => mark(Math.abs(style.wobble - option.value) < 0.05, option.label)),
  ];
  rows.push([L.backWriting]);
  return reply(rows);
}

function gapKeyboard(style: NotebookStyle): TgMarkup {
  const rows = [
    GAP_OPTIONS.map((option) =>
      mark(Math.abs(style.lineGap - Math.round(style.fontSize * option.ratio)) <= 1, option.label),
    ),
  ];
  rows.push([L.backWriting]);
  return reply(rows);
}

function mathKeyboard(style: NotebookStyle): TgMarkup {
  return reply([[style.mathMode ? MATH_ON : MATH_OFF], [L.backWriting]]);
}

function sendKeyboard(chatId: number): TgMarkup {
  const asFile = isFileMode(chatId);
  return reply([[mark(!asFile, SEND_PHOTO), mark(asFile, SEND_FILE)], [L.backWriting]]);
}

/** Shrift varaqasi tugmalari: `1 Caveat`, `2 Marck Script`, … */
function fontKeyboard(chatId: number, page: number, pageFonts: FontId[]): TgMarkup {
  const current = styleFor(chatId).font;
  const rows: string[][] = [];
  for (let index = 0; index < pageFonts.length; index += 2) {
    rows.push(
      pageFonts.slice(index, index + 2).map((id, offset) => {
        const number = index + offset + 1;
        return `${current === id ? "✓ " : ""}${number} ${displayName(id)}`;
      }),
    );
  }
  const navigation: string[] = [];
  if (page > 0) navigation.push(L.prevPage);
  if (page < FONT_PAGE_COUNT - 1) navigation.push(L.nextPage);
  if (navigation.length > 0) rows.push(navigation);
  rows.push([L.backSettings]);
  return reply(rows);
}

/**
 * Daftarlar ro'yxati: har bir daftar alohida qatorda. Tugma matni → daftar id
 * xaritasi sozlamalarga yoziladi, chunki nomlar takrorlanishi mumkin (nomni
 * o'zgartirish mumkin bo'lgani uchun nomga tayanib bo'lmaydi).
 */
async function booksKeyboard(chatId: number, list: Notebook[], store: NotebookStore): Promise<TgMarkup> {
  const rows: string[][] = [];
  const map: Record<string, string> = {};
  for (const notebook of list.slice(0, 8)) {
    const label = notebookButton(notebook, store);
    map[label] = notebook.id;
    rows.push([label]);
  }
  rows.push([L.newBook, L.backMain]);
  await updateSettings(chatId, { bookButtons: map });
  return reply(rows);
}

/** Daftar kartasi tugmalari: yozish, yuklab olish, nomini o'zgartirish. */
function cardKeyboard(): TgMarkup {
  return reply([[L.cardWrite], [L.cardDownload], [L.cardRename], [L.backBooks]]);
}

/** Daftar kartasi: nom, varaq/bet hisobi va amallar izohi. */
function cardText(chatId: number, notebook: Notebook, store: NotebookStore): string {
  const used = store.usedSides(notebook);
  const capacity = store.capacity(notebook);
  const active = rawSettings(chatId).notebookId === notebook.id;
  return [
    `📖 «${notebook.title}»${active ? " — ochiq daftar" : ""}`,
    "",
    `• Varaq: ${notebook.sheets} (${capacity} bet)`,
    `• Band: ${used}/${capacity} bet`,
    "",
    `Amalni tanlang: ${L.cardWrite}, ${L.cardDownload} yoki ${L.cardRename}.`,
  ].join("\n");
}

function newBookKeyboard(): TgMarkup {
  return reply([
    [SHEET_BUTTONS[0].text, SHEET_BUTTONS[1].text],
    [SHEET_BUTTONS[2].text, SHEET_BUTTONS[3].text],
    [L.backBooks],
  ]);
}

/** Daftar tugmasining matni: `📖 1-daftar • 5/24`. */
function notebookButton(notebook: Notebook, store: NotebookStore): string {
  return `📖 ${notebook.title} • ${store.usedSides(notebook)}/${store.capacity(notebook)}`;
}

/** Chatda band bo'lmagan nom: «Matematika» band bo'lsa «Matematika (2)». */
function uniqueTitle(list: Notebook[], wanted: string, excludeId?: string): string {
  const taken = new Set(list.filter((notebook) => notebook.id !== excludeId).map((notebook) => notebook.title));
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${wanted} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${wanted} (${Date.now() % 1000})`;
}

/** Nomsiz qoldirilganda beriladigan nom: eng kichik band bo'lmagan «N-daftar». */
function defaultBookTitle(list: Notebook[]): string {
  const taken = new Set(list.map((notebook) => notebook.title));
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${index}-daftar`;
    if (!taken.has(candidate)) return candidate;
  }
  return "daftar";
}

/* ------------------------------------------------------------------ */
/* Menyu matnlari                                                      */
/* ------------------------------------------------------------------ */

function welcomeText(): string {
  return [
    "👋 Assalomu alaykum! Men Daftar Bot — matningizni haqiqiy daftar varaqasidek qo'lda yozib beraman.",
    "",
    `📚 Avval ${L.newBook} bilan daftar yaratasiz (12, 36, 48 yoki 96 varaq va nom),`,
    `✍️ keyin ${L.text} orqali daftarni tanlab matn yuborasiz.`,
    "",
    `${L.books} bo'limida har bir daftar kartasi bor: ${L.cardWrite}, ${L.cardDownload},`,
    `${L.cardRename}.`,
    `${L.settings} ichida: siyoh rangi (10 xil), qog'oz turi (3 xil), yozuv uslubi`,
    `(${FONT_LIBRARY.length} qo'lyozma shrift) va yozuv sozlamalari bor.`,
  ].join("\n");
}

function settingsText(chatId: number): string {
  const style = styleFor(chatId);
  return [
    "⚙️ Sozlamalar",
    "",
    `• Siyoh: ${INK_LABEL[style.ink]} (${INK_HEX[style.ink]})`,
    `• Qog'oz: ${PAPER_LABEL[style.paper]} (A4)`,
    `• Yozuv: ${fontSummary(style.font)}`,
    `• O'lcham: ${style.fontSize}px • Qator: ${style.lineGap}px • Tebranish: ${style.wobble.toFixed(2)}`,
    `• Matematika: ${style.mathMode ? "yoniq" : "o'chiq"} • Yuborish: ${isFileMode(chatId) ? "PNG fayl" : "rasm"}`,
    "",
    "Kerakli bo'limni tanlang — har biri alohida ochiladi.",
  ].join("\n");
}

function writingText(chatId: number): string {
  const style = styleFor(chatId);
  return [
    "📐 Yozuv sozlamalari",
    "",
    `• O'lcham: ${style.fontSize}px`,
    `• Qo'l tebranishi: ${WOBBLE_OPTIONS.reduce((best, option) =>
      Math.abs(style.wobble - option.value) < Math.abs(style.wobble - best.value) ? option : best,
    ).label}`,
    `• Qator oralig'i: ${style.lineGap}px`,
    `• Matematika rejimi: ${style.mathMode ? "yoniq" : "o'chiq"}`,
    "",
    "Har bir sozlamani alohida ochib o'zgartirasiz.",
  ].join("\n");
}

function paperText(chatId: number): string {
  const style = styleFor(chatId);
  return [
    "📄 Qog'oz turi (A4)",
    "",
    ...PAPER_OPTIONS.map((option) => `${mark(style.paper === option.id, PAPER_SHORT[option.id])} — ${option.hint}`),
    "",
    "Tanlangan qog'oz keyingi barcha varaqalarga qo'llanadi.",
  ].join("\n");
}

function inkText(chatId: number): string {
  const style = styleFor(chatId);
  return [
    `🖋 Siyoh rangi — ${INK_OPTIONS.length} xil`,
    "",
    `Joriy: ${INK_LABEL[style.ink]} (${INK_HEX[style.ink]})`,
    "",
    "Rangni tanlang — keyingi rasmlar shu rangda chiqadi.",
  ].join("\n");
}

function sizeText(chatId: number): string {
  const style = styleFor(chatId);
  return [
    "🔠 Yozuv o'lchami",
    "",
    `Joriy: ${style.fontSize}px (qatorlar orasi ${style.lineGap}px)`,
    "",
    `Tanlang: ${SIZE_OPTIONS.join(", ")}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Menyuni ochish                                                      */
/* ------------------------------------------------------------------ */

/** Menyuni ochadi: matn + pastdagi klaviatura (va kerak bo'lsa shrift rasmi). */
async function openMenu(chatId: number, menu: MenuId): Promise<void> {
  const style = styleFor(chatId);
  await updateSettings(chatId, { menu });

  switch (menu) {
    case "ink":
      await sendMessage(chatId, inkText(chatId), inkKeyboard(style));
      return;
    case "paper":
      await sendMessage(chatId, paperText(chatId), paperKeyboard(style));
      return;
    case "writing":
      await sendMessage(chatId, writingText(chatId), writingKeyboard());
      return;
    case "size":
      await sendMessage(chatId, sizeText(chatId), sizeKeyboard(style));
      return;
    case "wobble":
      await sendMessage(
        chatId,
        "〰️ Qo'l tebranishi — yozuvning jonli ko'rinishi.\n\nTekis: deyarli bosma, Jonli: qo'l bilan tez yozilgan.",
        wobbleKeyboard(style),
      );
      return;
    case "gap":
      await sendMessage(
        chatId,
        "📏 Qator oralig'i — satrlar orasidagi masofa.\n\nZich: ko'proq matn sig'adi, Keng: katta yozuv uchun.",
        gapKeyboard(style),
      );
      return;
    case "math":
      await sendMessage(
        chatId,
        "🔢 Matematika rejimi — x^2, \\frac{a}{b}, \\sqrt{x} kabi yozuvlar tahlil qilinadi.",
        mathKeyboard(style),
      );
      return;
    case "send":
      await sendMessage(
        chatId,
        "🖼 Yuborish turi\n\nRasm sifatida — Telegram'da darhol ko'rinadi.\nPNG fayl sifatida — yuklab olish uchun (siqilmaydi).",
        sendKeyboard(chatId),
      );
      return;
    case "fonts": {
      const page = fontPageOf(chatId);
      await openFontPage(chatId, page);
      return;
    }
    case "newbook":
      await sendMessage(
        chatId,
        "➕ Yangi daftar\n\nDaftar varaq sonini tanlang. Har varaqning ikki tomoni bor: old tomonida chegara chapda, orqa tomonida — o'ngda.",
        newBookKeyboard(),
      );
      return;
    case "books": {
      const store = await books();
      const list = store.list(chatId);
      if (list.length === 0) {
        await sendMessage(
          chatId,
          "📚 Hozircha daftaringiz yo'q.\n\nMatn yozish uchun avval ➕ Yangi daftar bilan daftar yaratishingiz kerak.",
          newBookKeyboard(),
        );
        return;
      }
      await sendMessage(chatId, booksText(chatId, list, store), await booksKeyboard(chatId, list, store));
      return;
    }
    default:
      await sendMessage(chatId, welcomeText(), mainKeyboard());
  }
}

function booksText(chatId: number, list: Notebook[], store: NotebookStore): string {
  const active = rawSettings(chatId).notebookId;
  const lines = [
    "📚 Daftarlaringiz",
    "",
    ...list.map((notebook) => {
      const tag = notebook.id === active ? " ← ochiq" : "";
      return `${notebookButton(notebook, store)}${tag}`;
    }),
    "",
    `Daftarni bosing — kartasida yozish, kitob (PDF) qilib yuklab olish va nomini`,
    `o'zgartirish bor. Yangi daftar uchun ${L.newBook} tugmasini bosing.`,
  ];
  return lines.join("\n");
}

/** Daftar kartasini ochadi (yozish, yuklab olish, nomini o'zgartirish). */
async function openCard(chatId: number, notebookId: string): Promise<void> {
  const store = await books();
  const notebook = store.get(notebookId);
  if (!notebook || notebook.chatId !== chatId) {
    await openMenu(chatId, "books");
    return;
  }
  await updateSettings(chatId, { menu: "books", cardId: notebook.id });
  await sendMessage(chatId, cardText(chatId, notebook, store), cardKeyboard());
}

/** Shrift varaqasining bir sahifasini rasm ko'rinishida yuboradi. */
async function openFontPage(chatId: number, page: number): Promise<void> {
  const style = styleFor(chatId);
  const safePage = Math.min(FONT_PAGE_COUNT - 1, Math.max(0, page));
  const slice = FONT_LIBRARY.slice(safePage * FONT_PAGE_SIZE, (safePage + 1) * FONT_PAGE_SIZE);
  const pageFonts = slice.map((entry) => entry.id);
  await updateSettings(chatId, { menu: "fonts", fontPage: safePage });

  // Telegram shriftlarni ko'rsata olmaydi, shuning uchun ro'yxatni rasm qilib
  // yuboramiz: har bir nom o'z qo'lyozmasida chiziladi.
  const fonts = await loadFonts([...pageFonts, FALLBACK_FONT_ID]);
  const sheet = await renderFontSheet(pageFonts, fonts, {
    rowsPerSheet: FONT_PAGE_SIZE,
    title: `Yozuv uslubi ${safePage + 1}/${FONT_PAGE_COUNT}`,
    ink: style.ink,
    paper: "plain",
  });

  const caption = [
    `✍️ Yozuv uslubi — ${safePage + 1}-sahifa (${FONT_LIBRARY.length} shrift)`,
    "",
    "Rasmdagi raqamni pastdagi tugmalardan tanlang.",
    `Joriy: ${displayName(style.font)}`,
  ].join("\n");

  await sendPng(chatId, sheet.png, {
    asFile: false,
    filename: `shriftlar-${safePage + 1}.png`,
    caption,
    markup: fontKeyboard(chatId, safePage, pageFonts),
  });
}

/* ------------------------------------------------------------------ */
/* Daftar bilan ishlash                                                */
/* ------------------------------------------------------------------ */

/** Varaq tomoni: juft indeks — old tomon (chegara chapda), toq — orqa tomon. */
function sideOf(sideIndex: number): PageSide {
  return sideIndex % 2 === 0 ? "recto" : "verso";
}

function sideLabel(sideIndex: number): string {
  return sideOf(sideIndex) === "recto" ? "old tomoni (chegara chapda)" : "orqa tomoni (chegara o'ngda)";
}

/** Berilgan tomon uchun uslub: tomonga qarab birinchi varaqning tomoni belgilanadi. */
function sideStyle(chatId: number, sideIndex: number): NotebookStyle {
  return { ...styleFor(chatId), startSide: sideOf(sideIndex) };
}

/** Bitta tomonni chizib, foydalanuvchiga yuboradi. */
async function sendSide(chatId: number, notebook: Notebook, sideIndex: number): Promise<void> {
  const store = await books();
  const side = notebook.sides[sideIndex];
  if (!side || side.text.trim().length === 0) return;

  const style = sideStyle(chatId, sideIndex);
  const asFile = isFileMode(chatId);
  const fonts = await fontsFor(style);
  if (Object.keys(fonts).length === 0) {
    await sendMessage(chatId, "Kechirasiz, shrift fayllari topilmadi — botni qayta ishga tushirish kerak. 🙏");
    return;
  }

  await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" }).catch(() => undefined);

  const result = await renderNotebook({ text: side.text, style, fonts });
  if (result.pages.length === 0) return;

  const sheetNo = Math.floor(sideIndex / 2) + 1;
  const used = store.usedSides(notebook);
  const capacity = store.capacity(notebook);
  const base = [
    `📖 ${notebook.title} • ${sheetNo}/${notebook.sheets} varaq • ${sideIndex + 1}-bet • ${sideLabel(sideIndex)}`,
    `${PAPER_SHORT[style.paper]} • ${INK_LABEL[style.ink]} • ${displayName(style.font)}`,
  ];

  const notes: string[] = [];
  if (result.pages.length > MAX_RENDER_PAGES) notes.push(`Faqat birinchi ${MAX_RENDER_PAGES} varaqa yuborildi.`);
  // Tanlangan shrift kirillchani bilmasa, harflar zaxira shriftda chiziladi.
  if (CYRILLIC_RE.test(side.text) && !fontSupportsCyrillic(style.font)) {
    notes.push("Bu shrift kirillcha harflarni bilmaydi — ular zaxira shriftda chizildi.");
  }
  if (used >= capacity) notes.push("📕 Bu daftar to'ldi — ➕ Yangi daftar yaratishingiz mumkin.");
  else if (capacity - used <= 2) notes.push(`⏳ ${capacity - used} bet qoldi.`);

  const pages = result.pages.slice(0, MAX_RENDER_PAGES);
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const caption = [
      base.join("\n"),
      pages.length > 1 ? `(${index + 1}-varaqa)` : "",
      notes.length > 0 && index === pages.length - 1 ? `⚠️ ${notes.join(" ")}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    await sendPng(chatId, page.png, {
      asFile,
      filename: `${notebook.title}-${sideIndex + 1}.png`,
      caption,
      markup: index === 0 ? mainKeyboard() : undefined,
    });
  }
}

/** Joriy tomonga matn yozadi (tomon kerak bo'lsa ochiladi). */
async function writeToSide(notebookId: string, sideIndex: number, text: string): Promise<number | null> {
  const store = await books();
  let index = sideIndex;
  if (index < 0) {
    const created = await store.addSide(notebookId);
    if (!created) return null;
    index = store.usedSides(store.get(notebookId) as Notebook) - 1;
  }
  const ok = await store.setSideText(notebookId, index, text);
  return ok ? index : null;
}

/**
 * Foydalanuvchi matnini daftarga yozadi: joriy tomonga sig'gani yoziladi,
 * qolgani keyingi tomonga o'tadi (varaq to'lgani sari chegara tomoni almashadi).
 */
async function writeToNotebook(chatId: number, rawText: string): Promise<void> {
  const store = await books();
  const activeId = rawSettings(chatId).notebookId;
  const notebook = activeId ? store.get(activeId) : undefined;

  if (!notebook || notebook.chatId !== chatId) {
    await updateSettings(chatId, { notebookId: undefined });
    await offerNotebooks(chatId);
    return;
  }

  const body = rawText.trim().slice(0, MAX_CHARS);
  if (body.length === 0) {
    await sendMessage(chatId, "Iltimos, matn yuboring — men uni daftarga yozib beraman. 📝", mainKeyboard());
    return;
  }

  if (store.usedSides(notebook) >= store.capacity(notebook)) {
    await sendMessage(
      chatId,
      `📕 «${notebook.title}» daftari to'ldi (${notebook.sheets} varaq).\n\n➕ Yangi daftar yaratib, yozishni davom ettirasiz.`,
      newBookKeyboard(),
    );
    await updateSettings(chatId, { menu: "newbook" });
    return;
  }

  let remaining = body;
  let written = 0;
  const changed: number[] = [];
  const fonts = await fontsFor(styleFor(chatId));

  while (remaining.length > 0 && written < MAX_SIDES_PER_MESSAGE) {
    const usedSides = store.usedSides(notebook);
    const sideIndex = usedSides - 1;
    const base = sideIndex >= 0 ? notebook.sides[sideIndex].text : "";
    const candidate = base.length > 0 ? `${base}\n${remaining}` : remaining;
    const fit = await fitToSingleSide(candidate, {
      style: sideStyle(chatId, Math.max(0, sideIndex)),
      fonts,
    });

    if (fit.fitsEntirely) {
      const at = await writeToSide(notebook.id, sideIndex, candidate);
      if (at === null) break;
      changed.push(at);
      written += 1;
      remaining = "";
      break;
    }

    // Shu tomonga biror narsa sig'di — uni yozib, qolganini keyingisiga beramiz.
    if (fit.head.length > base.length || (sideIndex < 0 && fit.head.length > 0)) {
      const at = await writeToSide(notebook.id, sideIndex, fit.head);
      if (at === null) break;
      changed.push(at);
      written += 1;
      remaining = fit.tail.trim();
      continue;
    }

    // Bu tomonda joy yo'q (yoki birorta so'z ham sig'madi) — yangi tomon ochamiz.
    if (store.usedSides(notebook) >= store.capacity(notebook)) break;
    const created = await store.addSide(notebook.id);
    if (!created) break;

    // Hech narsa sig'masa ham yozib qo'yamiz (aks holda tsikl takrorlanardi).
    const retry = await fitToSingleSide(remaining, {
      style: sideStyle(chatId, store.usedSides(notebook) - 1),
      fonts,
    });
    const at = await writeToSide(notebook.id, store.usedSides(notebook) - 1, retry.head.length > 0 ? retry.head : remaining);
    if (at === null) break;
    changed.push(at);
    written += 1;
    remaining = retry.head.length > 0 ? retry.tail.trim() : "";
    if (retry.head.length === 0) break;
  }

  // Bir tomon bir necha marta yangilangan bo'lishi mumkin — har biri bir marta
  // yuboriladi (yakuniy matn bilan).
  for (const sideIndex of Array.from(new Set(changed))) {
    await sendSide(chatId, store.get(notebook.id) as Notebook, sideIndex);
  }

  if (remaining.length > 0) {
    await sendMessage(
      chatId,
      "Matn juda uzun edi — bir qismi yozildi. Qolganini keyingi xabar qilib yuboring. 📝",
      mainKeyboard(),
    );
  }

  if (changed.length === 0) {
    await sendMessage(chatId, "Matnni joylashtirib bo'lmadi. Boshqa shrift yoki qog'oz turini sinab ko'ring.", mainKeyboard());
  }
}

/** «✍️ Matn kiritish»: daftar ro'yxatini ko'rsatadi (yoki yaratishni taklif qiladi). */
async function offerNotebooks(chatId: number): Promise<void> {
  const store = await books();
  const list = store.list(chatId);
  if (list.length === 0) {
    await sendMessage(
      chatId,
      "📚 Hozircha daftaringiz yo'q.\n\nMatn yozishdan oldin ➕ Yangi daftar bilan daftar yaratishingiz kerak.",
      newBookKeyboard(),
    );
    await updateSettings(chatId, { menu: "newbook" });
    return;
  }

  const active = rawSettings(chatId).notebookId;
  await sendMessage(
    chatId,
    [
      "✍️ Qaysi daftarga yozamiz?",
      "",
      ...list.map((notebook) => `${notebookButton(notebook, store)}${notebook.id === active ? " ← ochiq" : ""}`),
      "",
      "Daftarni tanlang yoki ➕ Yangi daftar bilan yangisini oching.",
    ].join("\n"),
    await booksKeyboard(chatId, list, store),
  );
  await updateSettings(chatId, { menu: "books", booksAction: "write" });
}

/** Varaq soni tanlangach nom so'raydi (keyingi matn nom bo'ladi). */
async function askBookName(chatId: number, sheets: NotebookSheets): Promise<void> {
  const store = await books();
  const suggestion = defaultBookTitle(store.list(chatId));
  await updateSettings(chatId, { pending: { kind: "create", sheets }, menu: "newbook" });
  await sendMessage(
    chatId,
    [
      `✏️ Daftarga nom bering — keyingi xabaringiz nom bo'ladi (masalan: Matematika 8-sinf).`,
      "",
      `Nom kerak bo'lmasa ${L.skipName} tugmasini bosing: «${suggestion}» nomi bilan yaratiladi.`,
    ].join("\n"),
    reply([[L.skipName], [L.backBooks]]),
  );
}

/** Yangi daftar yaratadi va uni ochadi (nom berilmasa — standart nom). */
async function createNotebook(chatId: number, sheets: NotebookSheets, title?: string): Promise<void> {
  const store = await books();
  const list = store.list(chatId);
  const wanted = (title ? cleanTitle(title) : null) ?? defaultBookTitle(list);
  const notebook = await store.create({ chatId, sheets, title: uniqueTitle(list, wanted) });
  await updateSettings(chatId, { notebookId: notebook.id, menu: "main" });
  await sendMessage(
    chatId,
    [
      `✅ «${notebook.title}» yaratildi — ${sheets} varaq (${sheets * 2} bet).`,
      "",
      "Endi matn yuboring: men uni varaq tomonlariga ketma-ket yozib boraman.",
      "Old tomonida chegara chapda, orqa tomonida — o'ngda (xuddi daftar kabi).",
    ].join("\n"),
    mainKeyboard(),
  );
}

/** Daftar nomini almashtiradi (nom band bo'lsa raqam qo'shiladi). */
async function renameNotebook(chatId: number, notebookId: string, title: string): Promise<void> {
  const store = await books();
  const notebook = store.get(notebookId);
  if (!notebook || notebook.chatId !== chatId) {
    await sendMessage(chatId, "Daftar topilmadi — 📚 Daftarlar bo'limidan qayta urinib ko'ring.", mainKeyboard());
    return;
  }

  const cleaned = cleanTitle(title);
  if (!cleaned) {
    await sendMessage(chatId, "Nom bo'sh bo'lmasligi kerak — boshqa nom yozib ko'ring. ✏️", reply([[L.backBooks]]));
    return;
  }

  const next = uniqueTitle(store.list(chatId), cleaned, notebookId);
  if (!(await store.rename(notebookId, next))) {
    await sendMessage(chatId, "Nomni o'zgartirib bo'lmadi. Keyinroq urinib ko'ring. 🙏", mainKeyboard());
    return;
  }

  const updated = store.get(notebookId) as Notebook;
  await updateSettings(chatId, { cardId: notebookId });
  await sendMessage(
    chatId,
    [`✏️ Daftar nomi o'zgartirildi: «${updated.title}».`, "", cardText(chatId, updated, store)].join("\n"),
    cardKeyboard(),
  );
}

/**
 * Yozilgan betlarni kitob (PDF) qilib yuboradi.
 *
 * Kitob joriy sozlamalar (siyoh, qog'oz, shrift) bilan chiziladi; juda katta
 * daftarlar bir necha PDF qismiga bo'linadi.
 */
async function sendNotebookBook(chatId: number, notebook: Notebook): Promise<void> {
  const filled = notebook.sides
    .map((side, index) => ({ text: side.text, index }))
    .filter((entry) => entry.text.trim().length > 0);

  if (filled.length === 0) {
    await sendMessage(
      chatId,
      [
        `📄 «${notebook.title}» daftarida hali yozilgan bet yo'q.`,
        "",
        "Avval matn yuboring — shundan keyin kitobni yuklab olasiz.",
      ].join("\n"),
      cardKeyboard(),
    );
    return;
  }

  const style = styleFor(chatId);
  const fonts = await fontsFor(style);
  if (Object.keys(fonts).length === 0) {
    await sendMessage(chatId, "Kechirasiz, shrift fayllari topilmadi — botni qayta ishga tushirish kerak. 🙏");
    return;
  }

  const statusId = await sendMessage(
    chatId,
    `📄 «${notebook.title}» kitob qilib tayyorlanmoqda — ${filled.length} bet...`,
  );
  await tg("sendChatAction", { chat_id: chatId, action: "upload_document" }).catch(() => undefined);

  const result = await renderNotebookPdf({
    title: notebook.title,
    sides: filled.map((entry) => ({ text: entry.text, side: sideOf(entry.index) })),
    style,
    fonts,
    volumeBytes: PDF_VOLUME_BYTES,
    onPage: async (done, total) => {
      if (statusId && (done % PDF_PROGRESS_STEP === 0 || done === total)) {
        await editMessage(
          chatId,
          statusId,
          `📄 «${notebook.title}» kitob qilib tayyorlanmoqda — ${done}/${total} bet...`,
        );
      }
    },
  });

  const slug = slugifyTitle(notebook.title);
  const volumes = result.volumes;
  for (let index = 0; index < volumes.length; index += 1) {
    const volume = volumes[index];
    const filename = volumes.length > 1 ? `${slug}-${index + 1}-qism.pdf` : `${slug}.pdf`;
    const caption = [
      `📖 «${notebook.title}» — ${volume.pages} bet${volumes.length > 1 ? ` (${index + 1}/${volumes.length} qism)` : ""}`,
      `${PAPER_SHORT[style.paper]} • ${INK_LABEL[style.ink]} • ${displayName(style.font)}`,
      volumes.length > 1 ? "Daftar katta bo'lgani uchun kitob qismlarga bo'lindi." : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    await sendDocumentFile(chatId, volume.pdf, {
      filename,
      mime: "application/pdf",
      caption,
      markup: index === 0 ? mainKeyboard() : undefined,
    });
  }

  if (statusId) {
    await editMessage(
      chatId,
      statusId,
      `✅ «${notebook.title}» kitob qilib yuborildi — ${result.pages} bet${volumes.length > 1 ? `, ${volumes.length} qism` : ""}.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Pastki menyu tugmalarini qayta ishlash                              */
/* ------------------------------------------------------------------ */

/**
 * Tugma matnini amalga aylantiradi. `true` qaytsa — matn menyu buyrug'i
 * sifatida bajarildi (daftarga yozilmaydi).
 */
async function handleMenuLabelInner(chatId: number, label: string): Promise<boolean> {
  const style = styleFor(chatId);

  // 1. Menyu tugmalari.
  if (label === L.settings) {
    await sendMessage(chatId, settingsText(chatId), settingsKeyboard());
    await updateSettings(chatId, { menu: "settings" });
    return true;
  }
  const subMenus: [string, MenuId][] = [
    [L.ink, "ink"],
    [L.paper, "paper"],
    [L.font, "fonts"],
    [L.writing, "writing"],
    [L.books, "books"],
    [L.newBook, "newbook"],
    [L.sizeMenu, "size"],
    [L.wobbleMenu, "wobble"],
    [L.gapMenu, "gap"],
    [L.mathMenu, "math"],
    [L.sendMenu, "send"],
    [L.backMain, "main"],
    [L.backSettings, "settings"],
    [L.backWriting, "writing"],
    [L.backBooks, "books"],
    [L.backFonts, "fonts"],
  ];
  const subMenu = subMenus.find(([text]) => text === label);
  if (subMenu) {
    // `📚 Daftarlar` ro'yxatida daftar bosilganda karta ochiladi; `✍️ Matn
    // kiritish` ro'yxatida esa daftar to'g'ridan-to'g'ri tanlanadi.
    if (subMenu[1] === "books") await updateSettings(chatId, { booksAction: "manage" });
    await openMenu(chatId, subMenu[1]);
    return true;
  }

  // 1b. Daftar kartasi amallari (karta ochiq bo'lganda ko'rinadi).
  if (label === L.cardWrite || label === L.cardDownload || label === L.cardRename) {
    const store = await books();
    const cardId = rawSettings(chatId).cardId;
    const notebook = cardId ? store.get(cardId) : undefined;
    if (!notebook || notebook.chatId !== chatId) {
      await openMenu(chatId, "books");
      return true;
    }

    if (label === L.cardWrite) {
      await updateSettings(chatId, { notebookId: notebook.id, menu: "main" });
      await sendMessage(
        chatId,
        [
          `✍️ «${notebook.title}» ochildi — ${store.usedSides(notebook)}/${store.capacity(notebook)} bet band.`,
          "",
          "Endi yuborgan matningiz shu daftarga yoziladi.",
        ].join("\n"),
        mainKeyboard(),
      );
      return true;
    }

    if (label === L.cardRename) {
      await updateSettings(chatId, { pending: { kind: "rename", id: notebook.id } });
      await sendMessage(
        chatId,
        [
          `✏️ «${notebook.title}» uchun yangi nom yozib yuboring.`,
          "",
          "Keyingi xabaringiz daftar nomi bo'ladi.",
        ].join("\n"),
        reply([[L.backBooks]]),
      );
      return true;
    }

    await sendNotebookBook(chatId, notebook);
    return true;
  }

  // 1c. Nomsiz qoldirish (yangi daftarga nom so'ralganda).
  if (label === L.skipName) {
    const pending = rawSettings(chatId).pending;
    if (pending?.kind === "create") {
      await updateSettings(chatId, { pending: undefined });
      await createNotebook(chatId, pending.sheets);
    } else {
      await openMenu(chatId, "books");
    }
    return true;
  }

  if (label === L.text) {
    await offerNotebooks(chatId);
    return true;
  }

  // 2. Shrift sahifasini almashtirish.
  if (label === L.prevPage || label === L.nextPage) {
    const page = fontPageOf(chatId) + (label === L.prevPage ? -1 : 1);
    await openFontPage(chatId, page);
    return true;
  }

  // 3. Varaq soni tanlash (yangi daftar) — keyin nom so'raladi.
  const sheetChoice = SHEET_BUTTONS.find((option) => option.text === unmark(label));
  if (sheetChoice) {
    await askBookName(chatId, sheetChoice.sheets);
    return true;
  }

  // 4. Daftar tanlash (tugma matni → daftar id xaritasi orqali).
  const store = await books();
  if (label.startsWith("📖 ")) {
    const mapped = rawSettings(chatId).bookButtons?.[label];
    const notebook = mapped
      ? store.get(mapped)
      : store.list(chatId).find((item) => label.startsWith(`${notebookButton(item, store)}`));
    if (notebook && notebook.chatId === chatId) {
      if (rawSettings(chatId).booksAction === "manage") {
        await openCard(chatId, notebook.id);
        return true;
      }
      await updateSettings(chatId, { notebookId: notebook.id, menu: "main" });
      await sendMessage(
        chatId,
        [
          `📖 «${notebook.title}» ochildi — ${store.usedSides(notebook)}/${store.capacity(notebook)} bet band.`,
          "",
          "Endi matn yuboring; u ochiq varaq tomoniga yoziladi.",
        ].join("\n"),
        mainKeyboard(),
      );
      return true;
    }
  }

  // 5. Shrift tanlash: "3 Neucha".
  const fontMatch = /^(\d+)\s+(.+)$/.exec(unmark(label));
  if (fontMatch) {
    const page = fontPageOf(chatId);
    const index = Number.parseInt(fontMatch[1], 10) - 1;
    const entry = FONT_LIBRARY.slice(page * FONT_PAGE_SIZE, (page + 1) * FONT_PAGE_SIZE)[index];
    if (entry) {
      await updateSettings(chatId, { font: entry.id });
      await sendMessage(
        chatId,
        `✅ Yozuv uslubi: ${fontSummary(entry.id)}\n\nKeyingi rasmlar shu shriftda chiqadi.`,
        fontKeyboard(chatId, page, FONT_LIBRARY.slice(page * FONT_PAGE_SIZE, (page + 1) * FONT_PAGE_SIZE).map((item) => item.id)),
      );
      return true;
    }
  }

  // 6. Yozuv sozlamalari qiymatlari.
  const size = SIZE_OPTIONS.find((value) => String(value) === unmark(label));
  if (size) {
    const lineGap = Math.max(40, Math.round(size * 1.65));
    await updateSettings(chatId, { fontSize: size, lineGap });
    await sendMessage(chatId, `✅ O'lcham: ${size}px (qatorlar orasi ${lineGap}px)`, sizeKeyboard(styleFor(chatId)));
    return true;
  }

  const wobble = WOBBLE_OPTIONS.find((option) => option.label === unmark(label));
  if (wobble) {
    await updateSettings(chatId, { wobble: wobble.value });
    await sendMessage(chatId, `✅ Qo'l tebranishi: ${wobble.label}`, wobbleKeyboard(styleFor(chatId)));
    return true;
  }

  const gap = GAP_OPTIONS.find((option) => option.label === unmark(label));
  if (gap) {
    const lineGap = Math.max(40, Math.round(style.fontSize * gap.ratio));
    await updateSettings(chatId, { lineGap });
    await sendMessage(chatId, `✅ Qator oralig'i: ${gap.label} (${lineGap}px)`, gapKeyboard(styleFor(chatId)));
    return true;
  }

  if (unmark(label) === unmark(MATH_ON) || unmark(label) === unmark(MATH_OFF)) {
    const next = !style.mathMode;
    await updateSettings(chatId, { mathMode: next });
    await sendMessage(chatId, next ? "✅ Matematika rejimi yoniq." : "✅ Matematika rejimi o'chiq.", mathKeyboard(styleFor(chatId)));
    return true;
  }

  if (unmark(label) === unmark(SEND_PHOTO) || unmark(label) === unmark(SEND_FILE)) {
    const asFile = unmark(label) === unmark(SEND_FILE);
    await updateSettings(chatId, { asFile });
    await sendMessage(chatId, asFile ? "✅ Natija PNG fayl sifatida yuboriladi." : "✅ Natija rasm sifatida yuboriladi.", sendKeyboard(chatId));
    return true;
  }

  // 7. Siyoh ranglari va qog'oz turlari (✓ belgisi bilan keladi).
  const ink = INK_IDS.find((id) => INK_BUTTON[id] === unmark(label));
  if (ink) {
    await updateSettings(chatId, { ink });
    await sendMessage(chatId, `✅ Siyoh rangi: ${INK_LABEL[ink]} (${INK_HEX[ink]})`, inkKeyboard(styleFor(chatId)));
    return true;
  }

  const paper = PAPER_IDS.find((id) => PAPER_SHORT[id] === unmark(label));
  if (paper) {
    await updateSettings(chatId, { paper });
    await sendMessage(chatId, `✅ Qog'oz turi: ${PAPER_LABEL[paper]}`, paperKeyboard(styleFor(chatId)));
    return true;
  }

  return false;
}

/**
 * Menyu tugmasini bajaradi va kutib turgan matn holatini boshqaradi.
 *
 * Foydalanuvchi menyudan boshqa ishni tanlasa, eski holat (masalan, "nom
 * kutilmoqda") bekor qilinadi. Diqqat: handler o'zi yangi holat o'rnatgan
 * bo'lsa (masalan, `➕ Yangi daftar` dan keyin nom so'ralganda) uni
 * o'chirmasligimiz kerak — shuning uchun holat o'zgarganini ham tekshiramiz.
 */
async function handleMenuLabel(chatId: number, label: string): Promise<boolean> {
  const before = rawSettings(chatId).pending;
  const handled = await handleMenuLabelInner(chatId, label);
  const after = rawSettings(chatId).pending;
  if (handled && before && before === after) await updateSettings(chatId, { pending: undefined });
  return handled;
}

/**
 * Matn kutayotgan holatni bajaradi: yangi daftar nomi yoki mavjudining yangi
 * nomi. `true` qaytsa — matn daftarga yozilmaydi.
 */
async function handlePendingText(chatId: number, text: string): Promise<boolean> {
  const pending = rawSettings(chatId).pending;
  if (!pending) return false;

  await updateSettings(chatId, { pending: undefined });
  if (pending.kind === "create") {
    await createNotebook(chatId, pending.sheets, text);
    return true;
  }

  await renameNotebook(chatId, pending.id, text);
  return true;
}

/* ------------------------------------------------------------------ */
/* Buyruqlar                                                           */
/* ------------------------------------------------------------------ */

/** "/size 40" kabi buyruqni bo'laklarga ajratadi (bot nomi qo'shimchasini tashlab yuboradi). */
function parseCommand(text: string): { command: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase().split("@")[0];
  return { command, args: parts.slice(1) };
}

async function handleCommand(chatId: number, text: string): Promise<void> {
  const { command, args } = parseCommand(text);

  if (command === "/start" || command === "/help") {
    await updateSettings(chatId, { menu: "main" });
    await sendMessage(chatId, welcomeText(), mainKeyboard());
    return;
  }

  if (command === "/settings") {
    await sendMessage(chatId, settingsText(chatId), settingsKeyboard());
    await updateSettings(chatId, { menu: "settings" });
    return;
  }

  if (command === "/id") {
    await sendMessage(chatId, `Chat ID: ${chatId}`, mainKeyboard());
    return;
  }

  if (command === "/fonts") {
    await openFontPage(chatId, fontPageOf(chatId));
    return;
  }

  if (command === "/books" || command === "/daftarlar") {
    await updateSettings(chatId, { booksAction: "manage" });
    await openMenu(chatId, "books");
    return;
  }

  if (command === "/new") {
    await openMenu(chatId, "newbook");
    return;
  }

  if (command === "/font") {
    const requested = (args[0] ?? "").trim().toLowerCase().split("@")[0];

    if (!requested) {
      await openFontPage(chatId, fontPageOf(chatId));
      return;
    }

    const entry = fontEntry(requested);
    if (!entry) {
      await sendMessage(
        chatId,
        `"${requested}" id'li shrift topilmadi. Kutubxonada ${FONT_LIBRARY.length} shrift bor — ${L.font} bo'limidan rasm ko'rinishida ko'ring.`,
        mainKeyboard(),
      );
      return;
    }

    await updateSettings(chatId, { font: entry.id });
    await sendMessage(chatId, `✅ Yozuv uslubi: ${fontSummary(entry.id)}`, mainKeyboard());
    return;
  }

  const quickFont = QUICK_FONTS[command];
  if (quickFont) {
    await updateSettings(chatId, { font: quickFont });
    await sendMessage(chatId, `✅ Yozuv uslubi: ${fontSummary(quickFont)}`, mainKeyboard());
    return;
  }

  const paper = PAPER_IDS.find((id) => command === `/${id}`);
  if (paper) {
    await updateSettings(chatId, { paper });
    await sendMessage(chatId, `✅ Qog'oz turi: ${PAPER_LABEL[paper]}`, mainKeyboard());
    return;
  }

  const ink = INK_IDS.find((id) => command === `/${id}`);
  if (ink) {
    await updateSettings(chatId, { ink });
    await sendMessage(chatId, `✅ Siyoh rangi: ${INK_LABEL[ink]} (${INK_HEX[ink]})`, mainKeyboard());
    return;
  }

  if (command === "/size") {
    const requested = Number.parseInt(args[0] ?? "", 10);
    if (!Number.isFinite(requested)) {
      await sendMessage(
        chatId,
        `Foydalanish: /size ${SIZE_MIN}..${SIZE_MAX} (masalan /size 38). Hozir: ${styleFor(chatId).fontSize}px`,
        mainKeyboard(),
      );
      return;
    }
    const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, requested));
    const lineGap = Math.max(40, Math.round(size * 1.65));
    await updateSettings(chatId, { fontSize: size, lineGap });
    await sendMessage(chatId, `✅ Shrift o'lchami: ${size}px (qatorlar orasi ${lineGap}px)`, mainKeyboard());
    return;
  }

  if (command === "/file") {
    const next = !isFileMode(chatId);
    await updateSettings(chatId, { asFile: next });
    await sendMessage(
      chatId,
      next ? "✅ Endi natija PNG fayl sifatida yuboriladi." : "✅ Endi natija rasm sifatida yuboriladi.",
      mainKeyboard(),
    );
    return;
  }

  // Noma'lum buyruq: yordam matnini ko'rsatamiz.
  if (command.startsWith("/") && args.length === 0 && command.length <= 12) {
    await sendMessage(chatId, `Bunday buyruqni bilmayman: ${command}\n\n${HELP_TEXT}`, mainKeyboard());
    return;
  }

  await writeToNotebook(chatId, text);
}

/* ------------------------------------------------------------------ */
/* Update'larni qayta ishlash                                          */
/* ------------------------------------------------------------------ */

async function processUpdate(update: TgUpdate): Promise<void> {
  const message = update.message;
  if (!message?.chat || typeof message.text !== "string") return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/")) {
    await handleCommand(chatId, text);
    return;
  }

  if (await handleMenuLabel(chatId, text)) return;
  if (await handlePendingText(chatId, text)) return;

  await writeToNotebook(chatId, text);
}

/** Bitta update xato bersa ham bot yiqilmaydi: foydalanuvchiga qisqa uzr yuboramiz. */
async function processUpdateSafely(update: TgUpdate): Promise<void> {
  try {
    await processUpdate(update);
  } catch (error) {
    console.error("Update bajarilmadi:", error);
    const chatId = update.message?.chat?.id;
    if (chatId) {
      await sendMessage(
        chatId,
        "Kechirasiz, kutilmagan xatolik bo'ldi. Matnni qaytadan yuborib ko'ring. 🙏",
        mainKeyboard(),
      ).catch(() => undefined);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rejimlar                                                            */
/* ------------------------------------------------------------------ */

async function startPolling(): Promise<void> {
  // Avvalgi webhook bo'lsa, long polling bilan to'qnashmasligi uchun o'chiramiz.
  try {
    await tg("deleteWebhook", { drop_pending_updates: false });
  } catch (error) {
    console.warn("deleteWebhook bajarilmadi:", (error as Error).message);
  }

  const me = await tg<{ username?: string; first_name?: string }>("getMe");
  console.log(
    `🤖 @${me.username ?? "bot"} long polling rejimida ishga tushdi (${FONT_LIBRARY.length} shrift). To'xtatish: Ctrl+C.`,
  );

  let offset = 0;
  for (;;) {
    try {
      const updates = await tg<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 50,
        allowed_updates: ALLOWED_UPDATES,
      });
      for (const update of updates ?? []) {
        offset = Math.max(offset, update.update_id + 1);
        await processUpdateSafely(update);
      }
    } catch (error) {
      console.error("getUpdates xatosi:", (error as Error).message);
      await sleep(2000);
    }
  }
}

async function startWebhook(baseUrl: string): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const url = `${baseUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
  const secret = process.env.BOT_SECRET?.trim();

  const server = createServer((request, response) => {
    if (request.method !== "POST" || !request.url?.startsWith(WEBHOOK_PATH)) {
      response.writeHead(404).end("not found");
      return;
    }
    if (secret && request.headers["x-telegram-bot-api-secret-token"] !== secret) {
      response.writeHead(401).end("unauthorized");
      return;
    }

    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok");
      let update: TgUpdate;
      try {
        update = JSON.parse(Buffer.concat(chunks).toString("utf8")) as TgUpdate;
      } catch (error) {
        console.error("Update JSON o'qilmadi:", (error as Error).message);
        return;
      }
      void processUpdateSafely(update);
    });
    request.on("error", (error) => {
      console.error("So'rov xatosi:", error.message);
      response.writeHead(500).end("error");
    });
  });

  await new Promise<void>((done) => server.listen(port, "0.0.0.0", done));
  console.log(`🌐 Webhook server 0.0.0.0:${port}${WEBHOOK_PATH} da tinglayapti.`);

  await tg("setWebhook", {
    url,
    allowed_updates: ALLOWED_UPDATES,
    ...(secret ? { secret_token: secret } : {}),
  });
  console.log(`✅ Webhook ro'yxatga olindi: ${url}`);
}

async function printInfo(): Promise<void> {
  const me = await tg<{ id: number; username?: string; first_name?: string; can_join_groups?: boolean }>("getMe");

  const hook = await tg<{ url?: string; pending_update_count?: number; last_error_message?: string }>(
    "getWebhookInfo",
  );

  console.log("🤖 Bot:");
  console.log(`   nomi      : ${me.first_name ?? "-"}`);
  console.log(`   username  : @${me.username ?? "-"}`);
  console.log(`   id        : ${me.id}`);
  console.log("✍️  Shriftlar:");
  console.log(`   kutubxona : ${FONT_LIBRARY.length} shrift (${FONT_LIBRARY.filter((entry) => entry.cyrillic).length} ta kirill)`);
  console.log("🖋  Siyoh rangi:");
  console.log(`   ${INK_OPTIONS.map((option) => `${option.id} (${option.hex})`).join(", ")}`);
  console.log("📚 Daftar bazasi:");
  console.log(`   fayllar   : ${DATA_DIR} (settings.json, notebooks.json)`);
  console.log("🌐 Webhook:");
  console.log(`   url       : ${hook.url || "(yo'q — long polling ishlatiladi)"}`);
  console.log(`   kutilayotgan update: ${hook.pending_update_count ?? 0}`);
  if (hook.last_error_message) console.log(`   oxirgi xato: ${hook.last_error_message}`);
}

/* ------------------------------------------------------------------ */
/* Kirish nuqtasi                                                      */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const [mode = "poll", ...rest] = process.argv.slice(2);

  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error(
      [
        "❌ TELEGRAM_BOT_TOKEN topilmadi.",
        "",
        "1) @BotFather ga o'tib /newbot buyrug'i bilan bot yarating va tokenni oling.",
        "2) Freebuff'da Settings → Environment bo'limiga TELEGRAM_BOT_TOKEN kalitini qo'shing",
        "   (yoki loyihadagi .env fayliga TELEGRAM_BOT_TOKEN=... qatorini yozing).",
        "3) Keyin qaytadan urinib ko'ring: bun bot/index.ts",
      ].join("\n"),
    );
    process.exit(1);
  }

  // Standart shrift o'qilmasa, foydalanuvchi matn yuborganda buni darhol
  // bilish uchun ishga tushishda tekshiramiz.
  if (!(await loadFont(DEFAULT_STYLE.font))) {
    console.warn(`⚠️  Standart shrift ("${DEFAULT_STYLE.font}") o'qilmadi — shrift fayllarini tekshiring.`);
  }

  if (mode === "info") {
    await printInfo();
    return;
  }
  if (mode === "delete-webhook") {
    await tg("deleteWebhook", { drop_pending_updates: true });
    console.log("✅ Webhook o'chirildi. Endi long polling ishlatishingiz mumkin.");
    return;
  }
  if (mode === "webhook") {
    const baseUrl = rest[0]?.trim();
    if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
      console.error(
        "Foydalanish: bun bot/index.ts webhook https://<host>\nTelegram faqat HTTPS manzilni qabul qiladi.",
      );
      process.exit(1);
    }
    await startWebhook(baseUrl);
    return;
  }

  await startPolling();
}

/** Fayl bevosita ishga tushirilgandagina main() chaqiriladi (import qilinganda emas). */
const entry = process.argv[1];
if (entry && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  void (async () => {
    settingsCache = await loadSettings();
    notebookStore = await createStore(DATA_DIR);
    await main();
  })().catch((error) => {
    console.error("Bot to'xtab qoldi:", error);
    process.exit(1);
  });
}
