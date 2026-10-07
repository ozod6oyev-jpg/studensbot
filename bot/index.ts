/**
 * Daftar Bot — Telegram bot runtime.
 *
 * Foydalanuvchi matn yuboradi → bot uni daftar varaqasiga qo'lda yozilgan
 * ko'rinishda (chiziqli yoki katak) rasm qilib qaytaradi.
 *
 * Yozuv uslubi 39 ta qo'lyozma shriftdan tanlanadi
 * (`src/lib/handwriting/fonts.generated.ts`), ular faqat kerak bo'lganda
 * o'qiladi va keshda saqlanadi.
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
import {
  FALLBACK_FONT_ID,
  FONT_LIBRARY,
  fontEntry,
} from "../src/lib/handwriting/fonts.generated";
import { FONT_CATEGORIES, categoryLabel, fontSupportsCyrillic } from "../src/lib/handwriting/options";
import {
  DEFAULT_STYLE,
  type FontId,
  type InkColor,
  type NotebookStyle,
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

interface TgCallbackQuery {
  id: string;
  data?: string;
  message?: TgMessage;
  from?: { id: number };
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

interface TgApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

interface TgInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

/** Har bir chat uchun saqlanadigan sozlamalar. */
type ChatSettings = Partial<NotebookStyle> & { asFile?: boolean };
type SettingsMap = Record<string, ChatSettings>;
/** Chizish uchun yuklangan shrift baytlari (kalit — shrift id'si). */
type FontBytes = Record<string, Uint8Array>;

/* ------------------------------------------------------------------ */
/* Konstantalar                                                        */
/* ------------------------------------------------------------------ */

const PAPER_LABEL: Record<PaperType, string> = {
  lined: "yo'l-yo'l daftar",
  grid: "katak daftar",
  plain: "toza varaq",
};

/** Tugmalar uchun qisqa nomlar. */
const PAPER_SHORT: Record<PaperType, string> = {
  lined: "Yo'l-yo'l",
  grid: "Katak",
  plain: "Toza",
};

const INK_LABEL: Record<InkColor, string> = {
  blue: "ko'k ruchka",
  black: "qora ruchka",
  graphite: "qalam",
  green: "yashil ruchka",
  red: "qizil ruchka",
  purple: "siyohrang ruchka",
};

const INK_HEX: Record<InkColor, string> = {
  blue: "#1B3E8F",
  black: "#1F1F26",
  graphite: "#4B4B55",
  green: "#1F6B4A",
  red: "#B3253B",
  purple: "#5B3A8E",
};

const PAPER_IDS: PaperType[] = ["lined", "grid", "plain"];
const INK_IDS: InkColor[] = ["blue", "black", "graphite", "green", "red", "purple"];

/** Tugmalarda ko'rsatiladigan eng ko'p ishlatiladigan shriftlar. */
const POPULAR_FONTS: FontId[] = [
  "caveat",
  "marckscript",
  "badscript",
  "neucha",
  "patrickhand",
  "dancingscript",
  "pangolin",
  "kalam",
  "shadowsintolight",
  "caveatbrush",
  "greatvibes",
  "amaticsc",
];

const ALLOWED_UPDATES = ["message", "callback_query"];
const MAX_PAGES = 12;
const MAX_CHARS = 4000;
const SIZE_MIN = 26;
const SIZE_MAX = 52;
const WEBHOOK_PATH = "/telegram/webhook";
/** Telegram xabar chegarasi 4096 belgi — undan sal pastroq xavfsiz chegara. */
const TEXT_LIMIT = 3800;
const CYRILLIC_RE = /[\u0400-\u04FF]/;

const HELP_TEXT = [
  "📓 Daftar Bot — matningizni daftarga qo'lda yozilgan ko'rinishda rasm qilib beraman.",
  "",
  "Menga oddiy matn yuboring (adabiyot, insho, diktant) yoki matematika misollari.",
  "",
  "Daftar va siyoh:",
  "/lined — yo'l-yo'l daftar, /grid — katak daftar, /plain — toza varaq",
  "/blue /black /graphite /green /red /purple — siyoh rangi",
  "",
  "Yozuv uslubi:",
  `/fonts — ${FONT_LIBRARY.length} qo'lyozma shriftli kutubxona`,
  "/font <id> — shriftni tanlash (masalan /font badscript)",
  "/caveat /marck — tez tanlash: erkin yoki ozoda yozuv",
  "/size 26..52 — shrift o'lchami",
  "",
  "Boshqa:",
  "/file — natijani PNG fayl sifatida yuborish (yoki rasm sifatida)",
  "/settings — sozlamalar tugmalari",
  "/help — shu yordam",
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

/** Shriftning ko'rsatiladigan nomi: "Marck Script — ozoda yozuv" → "Marck Script". */
function displayName(id: FontId): string {
  const entry = fontEntry(id);
  if (!entry) return id;
  const short = entry.label.split(" — ")[0];
  return short || entry.family || id;
}

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

/** PNG'ni multipart/form-data orqali rasm yoki fayl sifatida yuboradi. */
async function sendPng(
  chatId: number,
  png: Uint8Array,
  options: {
    asFile: boolean;
    filename: string;
    caption?: string;
    keyboard?: TgInlineKeyboard;
  },
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (options.caption) form.append("caption", options.caption.slice(0, 1000));
  if (options.keyboard) form.append("reply_markup", JSON.stringify(options.keyboard));

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

async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: TgInlineKeyboard,
): Promise<void> {
  await tg("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
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

/**
 * Berilgan uslub uchun zarur shriftlarni yuklaydi: tanlangan shrift va
 * (yetim belgilar uchun) zaxira shrift. Kutubxonaning qolgan 37 shrifti
 * tarmoqqa ham, xotiraga ham tegmaydi.
 */
async function fontsFor(style: NotebookStyle): Promise<FontBytes> {
  const ids = [style.font, FALLBACK_FONT_ID].filter((id, index, list) => list.indexOf(id) === index);
  const loaded = await Promise.all(ids.map((id) => loadFont(id)));

  const fonts: FontBytes = {};
  ids.forEach((id, index) => {
    const bytes = loaded[index];
    if (bytes) fonts[id] = bytes;
  });
  return fonts;
}

/* ------------------------------------------------------------------ */
/* Klaviaturalar                                                       */
/* ------------------------------------------------------------------ */

/** Shrift tanlash klaviaturasi (mashhur shriftlar + to'liq ro'yxat). */
function fontKeyboard(chatId: number): TgInlineKeyboard {
  const current = styleFor(chatId).font;
  const rows: { text: string; callback_data: string }[][] = [];

  for (let index = 0; index < POPULAR_FONTS.length; index += 2) {
    rows.push(
      POPULAR_FONTS.slice(index, index + 2).map((id) => ({
        text: `${current === id ? "✓ " : ""}${displayName(id)}`,
        callback_data: `font:${id}`,
      })),
    );
  }

  rows.push([{ text: `Barcha ${FONT_LIBRARY.length} shrift`, callback_data: "open:fonts" }]);
  return { inline_keyboard: rows };
}

/** Har bir rasm ostidagi tez tugmalar. */
function quickKeyboard(chatId: number): TgInlineKeyboard {
  const style = styleFor(chatId);
  const asFile = isFileMode(chatId);
  return {
    inline_keyboard: [
      [
        { text: "Yo'l-yo'l", callback_data: "paper:lined" },
        { text: "Katak", callback_data: "paper:grid" },
        { text: "Toza", callback_data: "paper:plain" },
      ],
      [
        { text: "Ko'k", callback_data: "ink:blue" },
        { text: "Qora", callback_data: "ink:black" },
        { text: asFile ? "Rasm sifatida" : "PNG fayl sifatida", callback_data: "toggle:file" },
      ],
      [
        { text: `✍️ ${displayName(style.font)}`, callback_data: "open:fonts" },
        { text: "⚙️ Sozlamalar", callback_data: "open:settings" },
      ],
    ],
  };
}

/** /settings xabari uchun tugmalar (joriy qiymat ✓ bilan belgilanadi). */
function settingsKeyboard(chatId: number): TgInlineKeyboard {
  const style = styleFor(chatId);
  const asFile = isFileMode(chatId);
  const mark = (active: boolean, label: string) => `${active ? "✓ " : ""}${label}`;
  return {
    inline_keyboard: [
      PAPER_IDS.map((id) => ({ text: mark(style.paper === id, PAPER_SHORT[id]), callback_data: `paper:${id}` })),
      INK_IDS.slice(0, 3).map((id) => ({ text: mark(style.ink === id, INK_LABEL[id].split(" ")[0]), callback_data: `ink:${id}` })),
      INK_IDS.slice(3).map((id) => ({ text: mark(style.ink === id, INK_LABEL[id].split(" ")[0]), callback_data: `ink:${id}` })),
      [{ text: `✍️ Yozuv: ${displayName(style.font)}`, callback_data: "open:fonts" }],
      [
        { text: mark(!asFile, "Rasm sifatida"), callback_data: "file:off" },
        { text: mark(asFile, "PNG fayl sifatida"), callback_data: "file:on" },
      ],
    ],
  };
}

function settingsText(chatId: number, asFile: boolean): string {
  const style = styleFor(chatId);
  const entry = fontEntry(style.font);
  const fontLine = entry
    ? `${displayName(entry.id)} • ${categoryLabel(entry.category)}${entry.cyrillic ? " • kirill ✓" : ""}`
    : displayName(style.font);
  return [
    "⚙️ Joriy sozlamalar",
    "",
    `• Qog'oz: ${PAPER_LABEL[style.paper]}`,
    `• Siyoh: ${INK_LABEL[style.ink]} (${INK_HEX[style.ink]})`,
    `• Yozuv: ${fontLine}`,
    `• Shrift o'lchami: ${style.fontSize}px`,
    `• Yuborish: ${asFile ? "PNG fayl" : "rasm (foto)"}`,
    "",
    `Tugmalardan birini tanlang — keyingi matningiz shu uslubda chiqadi. Kutubxonada ${FONT_LIBRARY.length} shrift bor: /fonts`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Shriftlar ro'yxati                                                  */
/* ------------------------------------------------------------------ */

/** Kutubxonani kategoriyalar bo'yicha matn ko'rinishida tayyorlaydi. */
function fontLibraryText(currentId: FontId): string {
  const lines: string[] = [
    `✍️ Shriftlar kutubxonasi — ${FONT_LIBRARY.length} qo'lyozma shrift`,
    "",
    "Tanlash: /font <id> (masalan /font badscript)",
  ];

  for (const category of FONT_CATEGORIES) {
    const fonts = FONT_LIBRARY.filter((entry) => entry.category === category.id);
    if (fonts.length === 0) continue;
    lines.push("", `${category.label} (${fonts.length}):`);
    for (const entry of fonts) {
      lines.push(
        `${entry.id === currentId ? "✓ " : ""}${entry.id} — ${displayName(entry.id)}${entry.cyrillic ? " (kirill)" : ""}`,
      );
    }
  }

  return lines.join("\n");
}

/** Xabarni Telegram chegarasiga sig'diradi: faqat butun qatorlar qoldiriladi. */
function clipLines(text: string, limit = TEXT_LIMIT): string {
  if (text.length <= limit) return text;

  const kept: string[] = [];
  let length = 0;
  for (const line of text.split("\n")) {
    if (length + line.length + 1 > limit - 150) break;
    kept.push(line);
    length += line.length + 1;
  }
  kept.push("", "…ro'yxat qisqartirildi. Istalgan shrift id'sini /font <id> bilan tanlaysiz.");
  return kept.join("\n");
}

function fontLibraryMessage(chatId: number): string {
  return clipLines(fontLibraryText(styleFor(chatId).font));
}

/* ------------------------------------------------------------------ */
/* Render va yuborish                                                  */
/* ------------------------------------------------------------------ */

/** Matnni daftar varaqalariga aylantirib, foydalanuvchiga yuboradi. */
async function handleRender(chatId: number, rawText: string): Promise<void> {
  const text = rawText.trim();
  if (!text) {
    await sendMessage(chatId, "Iltimos, matn yuboring — men uni daftarga yozib beraman. 📝");
    return;
  }

  const truncated = text.length > MAX_CHARS;
  const body = truncated ? text.slice(0, MAX_CHARS) : text;
  const style = styleFor(chatId);
  const asFile = isFileMode(chatId);

  await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" }).catch(() => undefined);

  const fonts = await fontsFor(style);
  if (Object.keys(fonts).length === 0) {
    await sendMessage(chatId, "Kechirasiz, shrift fayllari topilmadi — botni qayta ishga tushirish kerak. 🙏");
    return;
  }

  const result = await renderNotebook({ text: body, style, fonts });

  if (result.pages.length === 0) {
    await sendMessage(chatId, "Matn bo'sh ko'rindi — yozib ko'ring. 🤔");
    return;
  }

  const pages = result.pages.slice(0, MAX_PAGES);
  const notes: string[] = [];
  if (truncated) notes.push("Matn juda uzun edi — boshi olindi.");
  if (result.pages.length > MAX_PAGES) {
    notes.push(`Faqat birinchi ${MAX_PAGES} varaq yuborildi.`);
  }
  if (result.warnings.length > 0) {
    notes.push(result.warnings.slice(0, 2).join(" "));
  }
  // Tanlangan shrift kirillchani bilmasa, harflar zaxira shriftda chiziladi —
  // buni bir marta, izohning oxirida aytamiz.
  if (CYRILLIC_RE.test(body) && !fontSupportsCyrillic(style.font)) {
    notes.push(
      "Bu shrift kirillcha harflarni bilmaydi — ular zaxira shriftda chizildi. /fonts bilan boshqa shrift tanlang.",
    );
  }
  const note = notes.join(" ");

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const caption =
      index === 0
        ? `${page.index}/${pages.length} varaq • ${PAPER_LABEL[style.paper]} • ${INK_LABEL[style.ink]} • ${displayName(
            style.font,
          )}`
        : `${page.index}/${pages.length} varaq`;
    await sendPng(chatId, page.png, {
      asFile,
      filename: `daftar-${page.index}.png`,
      caption: note ? `${caption}\n\n⚠️ ${note}` : caption,
      keyboard: index === 0 ? quickKeyboard(chatId) : undefined,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Buyruqlar va tugmalar                                               */
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
    await sendMessage(chatId, HELP_TEXT, settingsKeyboard(chatId));
    return;
  }

  if (command === "/settings") {
    await sendMessage(chatId, settingsText(chatId, isFileMode(chatId)), settingsKeyboard(chatId));
    return;
  }

  if (command === "/id") {
    await sendMessage(chatId, `Chat ID: ${chatId}`);
    return;
  }

  if (command === "/fonts") {
    await sendMessage(chatId, fontLibraryMessage(chatId), fontKeyboard(chatId));
    return;
  }

  if (command === "/font") {
    const requested = (args[0] ?? "").trim().toLowerCase().split("@")[0];

    if (!requested) {
      await sendMessage(
        chatId,
        `Joriy yozuv uslubi: ${displayName(styleFor(chatId).font)}\n\nShriftni tugmalardan tanlang yoki /fonts bilan to'liq ro'yxatni ko'ring.`,
        fontKeyboard(chatId),
      );
      return;
    }

    const entry = fontEntry(requested);
    if (!entry) {
      const suggestions = POPULAR_FONTS.slice(0, 4)
        .map((id) => `${id} — ${displayName(id)}`)
        .join("\n");
      await sendMessage(
        chatId,
        `"${requested}" id'li shrift topilmadi.\n\nMashhur shriftlar:\n${suggestions}\n\nBarcha ${FONT_LIBRARY.length} shrift: /fonts`,
      );
      return;
    }

    await updateSettings(chatId, { font: entry.id });
    await sendMessage(
      chatId,
      `✅ Yozuv uslubi: ${displayName(entry.id)} (${categoryLabel(entry.category)}${entry.cyrillic ? ", kirill ✓" : ""})`,
    );
    return;
  }

  const paper = PAPER_IDS.find((id) => command === `/${id}`);
  if (paper) {
    await updateSettings(chatId, { paper });
    await sendMessage(chatId, `✅ Qog'oz turi: ${PAPER_LABEL[paper]}`);
    return;
  }

  const inkAliases: Record<string, InkColor> = {
    "/blue": "blue",
    "/black": "black",
    "/graphite": "graphite",
    "/green": "green",
    "/red": "red",
    "/purple": "purple",
  };
  const ink = inkAliases[command];
  if (ink) {
    await updateSettings(chatId, { ink });
    await sendMessage(chatId, `✅ Siyoh rangi: ${INK_LABEL[ink]} (${INK_HEX[ink]})`);
    return;
  }

  // Qisqa tez tanlash: eng ko'p ishlatiladigan ikki shrift.
  if (command === "/caveat" || command === "/marck") {
    const font: FontId = command === "/caveat" ? "caveat" : "marck";
    await updateSettings(chatId, { font });
    await sendMessage(chatId, `✅ Yozuv uslubi: ${displayName(font)}`);
    return;
  }

  if (command === "/size") {
    const requested = Number.parseInt(args[0] ?? "", 10);
    if (!Number.isFinite(requested)) {
      await sendMessage(chatId, `Foydalanish: /size 26..52 (masalan /size 38). Hozir: ${styleFor(chatId).fontSize}px`);
      return;
    }
    const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, requested));
    const lineGap = Math.max(40, Math.round(size * 1.65));
    await updateSettings(chatId, { fontSize: size, lineGap });
    await sendMessage(chatId, `✅ Shrift o'lchami: ${size}px (qatorlar orasi ${lineGap}px)`);
    return;
  }

  if (command === "/file") {
    const next = !isFileMode(chatId);
    await updateSettings(chatId, { asFile: next });
    await sendMessage(chatId, next ? "✅ Endi natija PNG fayl sifatida yuboriladi." : "✅ Endi natija rasm sifatida yuboriladi.");
    return;
  }

  // Noma'lum buyruq: uni oddiy matn kabi render qilib ko'ramiz.
  if (command.startsWith("/") && args.length === 0 && command.length <= 12) {
    await sendMessage(chatId, `Bunday buyruqni bilmayman: ${command}\n\n${HELP_TEXT}`);
    return;
  }
  await handleRender(chatId, text);
}

/** Inline tugma bosilganda sozlamani yangilaydi (qayta render qilinmaydi). */
async function handleCallback(query: TgCallbackQuery): Promise<void> {
  const chatId = query.message?.chat?.id;
  const data = query.data ?? "";
  if (!chatId) {
    await tg("answerCallbackQuery", { callback_query_id: query.id }).catch(() => undefined);
    return;
  }

  const [kind, value] = data.split(":");
  let confirmation = "";

  if (kind === "paper" && PAPER_IDS.includes(value as PaperType)) {
    await updateSettings(chatId, { paper: value as PaperType });
    confirmation = `✅ ${PAPER_LABEL[value as PaperType]}`;
  } else if (kind === "ink" && INK_IDS.includes(value as InkColor)) {
    await updateSettings(chatId, { ink: value as InkColor });
    confirmation = `✅ ${INK_LABEL[value as InkColor]}`;
  } else if (kind === "font" && fontEntry(value)) {
    await updateSettings(chatId, { font: value });
    confirmation = `✅ Yozuv uslubi: ${displayName(value)}`;
  } else if (kind === "file" || (kind === "toggle" && value === "file")) {
    const next = !isFileMode(chatId);
    await updateSettings(chatId, { asFile: next });
    confirmation = next ? "✅ PNG fayl sifatida yuboraman" : "✅ Rasm sifatida yuboraman";
  } else if (kind === "open" && value === "fonts") {
    await tg("answerCallbackQuery", { callback_query_id: query.id, text: "✍️ Shriftlar" }).catch(() => undefined);
    await sendMessage(chatId, fontLibraryMessage(chatId), fontKeyboard(chatId));
    return;
  } else if (kind === "open" && value === "settings") {
    confirmation = "⚙️ Sozlamalar";
    await tg("answerCallbackQuery", { callback_query_id: query.id, text: confirmation }).catch(() => undefined);
    await sendMessage(chatId, settingsText(chatId, isFileMode(chatId)), settingsKeyboard(chatId));
    return;
  } else {
    await tg("answerCallbackQuery", { callback_query_id: query.id }).catch(() => undefined);
    return;
  }

  await tg("answerCallbackQuery", { callback_query_id: query.id, text: confirmation }).catch(() => undefined);
  await sendMessage(chatId, `${confirmation}. Keyingi matningiz shu uslubda chiqadi.`);

  // Tugmalar qaysi xabardan bosilgan bo'lsa, o'sha xabarning klaviaturasini
  // yangilaymiz: /settings panelida ✓ belgilari, rasm ostida tez tugmalar.
  const message = query.message;
  if (message) {
    const fromSettingsPanel = (message.text ?? "").startsWith("⚙️");
    await tg("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: message.message_id,
      reply_markup: fromSettingsPanel ? settingsKeyboard(chatId) : quickKeyboard(chatId),
    }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Update'larni qayta ishlash                                          */
/* ------------------------------------------------------------------ */

async function processUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.chat || typeof message.text !== "string") return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/")) {
    await handleCommand(chatId, text);
    return;
  }
  await handleRender(chatId, text);
}

/** Bitta update xato bersa ham bot yiqilmaydi: foydalanuvchiga qisqa uzr yuboramiz. */
async function processUpdateSafely(update: TgUpdate): Promise<void> {
  try {
    await processUpdate(update);
  } catch (error) {
    console.error("Update bajarilmadi:", error);
    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (chatId) {
      await sendMessage(
        chatId,
        "Kechirasiz, kutilmagan xatolik bo'ldi. Matnni qaytadan yuborib ko'ring. 🙏",
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
    await main();
  })().catch((error) => {
    console.error("Bot to'xtab qoldi:", error);
    process.exit(1);
  });
}
