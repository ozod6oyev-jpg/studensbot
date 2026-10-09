/**
 * Daftar Bot — Telegram bot runtime.
 *
 * Foydalanuvchi matn yuboradi → bot uni daftar varaqasiga qo'lda yozilgan
 * ko'rinishda rasm qilib qaytaradi.
 *
 * `🖋 Uslubimni nusxalash` bo'limi foydalanuvchining **o'z qo'lyozmasini**
 * o'lchaydi: 10 ta so'z yo'l-yo'l daftarga, 10 ta raqam katak daftarga yozilib
 * suratga olinadi, bot o'lchovlar bo'yicha eng yaqin shriftni tanlab, unga
 * qiyalik/qalinlik/kenglik kabi tuzatishlarni qo'llaydi va natijani shu
 * foydalanuvchi uchun saqlaydi (boshqalarga ko'rinmaydi).
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
 * `MINI_APP_URL` o'rnatilgan bo'lsa, bot Studio'ni **Telegram Mini App** sifatida
 * ochadigan tugmalarni o'zi qo'yadi: chat menyusi tugmasi (`setChatMenuButton`),
 * pastdagi klaviaturadagi 🖥 tugma va `/studio` buyrug'i. Studio esa matn bilan
 * birga `initData` ni `/mini-app/send` manziliga yuboradi — bot imzoni tekshirib,
 * varaqalarni o'sha chatga chizib beradi (webhook shart emas: HTTP server long
 * polling rejimida ham ishga tushadi).
 *
 * Ishga tushirish:
 *   bun bot/index.ts                 # long polling (eng oddiy usul)
 *   bun bot/index.ts poll
 *   bun bot/index.ts webhook https://mening-botim.example.com
 *   bun bot/index.ts info
 *   bun bot/index.ts delete-webhook
 *
 * Env: TELEGRAM_BOT_TOKEN (majburiy), BOT_SECRET (ixtiyoriy), PORT (HTTP server uchun),
 *      BOT_DATA_DIR (standart: ./bot/data), TELEGRAM_API_BASE (o'z Bot API serveri),
 *      MINI_APP_URL (Studio'ning HTTPS manzili — Mini App uchun),
 *      MINI_APP_ALLOW_ORIGINS (ixtiyoriy: Mini App uchun qo'shimcha domenlar).
 */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import {
  HEALTH_PATH,
  MINI_APP_NOTEBOOK_PATH,
  MINI_APP_PATH,
  MINI_APP_STATE_PATH,
  createMiniAppHandler,
  originFromUrl,
  type MiniAppNotebookInfo,
  type MiniAppNotebookRequest,
  type MiniAppNotebookResult,
  type MiniAppRequest,
  type MiniAppResult,
  type MiniAppSideInfo,
  type MiniAppState,
  type MiniAppStateRequest,
} from "./mini-app";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderNotebook } from "../src/lib/handwriting/render";
import { renderFontSheet } from "../src/lib/handwriting/font-sheet";
import { renderNotebookPdf, slugifyTitle } from "../src/lib/handwriting/notebook-pdf";
import { fitToSingleSide } from "../src/lib/handwriting/fit";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";
import { INK_OPTIONS, PAGE_FORMAT_OPTIONS, PAPER_OPTIONS, categoryLabel, fontSupportsCyrillic } from "../src/lib/handwriting/options";
import { fontDisplayName, fontSummary } from "../src/lib/handwriting/names";
import { calibrateStyle, personalSummary } from "../src/lib/handwriting/calibrate";
import { parseFont } from "../src/lib/handwriting/font";
import { linesPerPageFor } from "../src/lib/handwriting/layout";
import {
  appendChunk,
  deleteWordRange,
  measureSideText,
  wordsOf,
  type SideTextMeasure,
} from "../src/lib/handwriting/notebook-text";
import { decodeSampleImage } from "../src/lib/handwriting/image";
import { analyzeSample, mergeProfiles, sampleQuality, type SampleProfile } from "../src/lib/handwriting/sample";
import {
  MAX_STYLES_PER_CHAT,
  PAPER_CHOICES,
  SHEET_CHOICES,
  cleanStyleName,
  cleanTitle,
  createStore,
  createStyleStore,
  type Notebook,
  type NotebookSheets,
  type NotebookStore,
  type StyleRecord,
  type StyleStore,
} from "./db";
import {
  DEFAULT_STYLE,
  type FontId,
  type InkColor,
  type NotebookStyle,
  type PageFormat,
  type PageSide,
  type PaperType,
  type PersonalStyle,
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
  /** Telegram rasmni bir necha o'lchamda yuboradi (eng kattasi oxirida). */
  photo?: { file_id: string; width?: number; height?: number }[];
  /** Hujjat sifatida yuborilgan rasm (masalan PNG skrinshot). */
  document?: { file_id: string; mime_type?: string; file_name?: string };
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

/**
 * Klaviatura tugmasi. `web_app` berilgan tugma Telegram ichida Mini App
 * (Studio) sahifasini ochadi.
 */
interface TgKeyboardButton {
  text: string;
  web_app?: { url: string };
}

/** Pastdagi doimiy klaviatura (reply keyboard). */
interface TgReplyKeyboard {
  keyboard: TgKeyboardButton[][];
  resize_keyboard: boolean;
  is_persistent: boolean;
  input_field_placeholder?: string;
}

/** Xabar ostidagi (inline) klaviatura — Mini App havolasi uchun. */
interface TgInlineKeyboard {
  inline_keyboard: TgKeyboardButton[][];
}

type TgMarkup = TgReplyKeyboard | TgInlineKeyboard;

/** Tugma tavsifi: oddiy matn yoki Mini App manzili bilan. */
type ButtonSpec = string | { text: string; webApp: string };

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
  | "newbook"
  | "style"
  | "edit";

/**
 * Bot matn kutayotgan holat: daftarga nom berish, nomini o'zgartirish yoki
 * yangi shaxsiy uslubga nom berish.
 */
type PendingInput =
  | { kind: "create"; sheets: NotebookSheets; paper?: PaperType }
  | { kind: "rename"; id: string }
  | { kind: "styleName" };

/**
 * «Uslubimni nusxalash» oqimida nima kutilmoqda: namuna rasmi (so'zlar yoki
 * raqamlar) yoki bir nechta uslubdan qaysi biri o'chirilishi.
 */
type StyleStep = "words" | "digits" | "delete";

/** Yozish oqimi: qaysi betning qaysi qatoridan yoziladi. */
type WriteStage = "position" | "line" | "skip" | "ready";

interface WriteFlow {
  notebookId: string;
  /** Yoziladigan bet (tomon) indeksi. */
  sideIndex: number;
  /** Tanlangan qator (1 dan). Tanlanmagan bo'lsa — keyingi bo'sh qator. */
  line?: number;
  stage: WriteStage;
}

/** Betdagi aniq joy: qator va undagi so'z raqami (1 dan). */
interface SidePoint {
  side: number;
  line: number;
  word: number;
}

/** O'chirish oqimi: qaysi oraliqdagi so'zlar o'chiriladi. */
type DeleteStage = "side" | "startLine" | "startWord" | "endSide" | "endLine" | "endWord" | "confirm";

interface DeleteFlow {
  notebookId: string;
  stage: DeleteStage;
  start?: SidePoint;
  end?: SidePoint;
}

/** Namunadan hisoblangan, hali nom berilmagan uslub. */
interface StyleDraft {
  baseFont: FontId;
  personal: PersonalStyle;
  summary: string;
}

/** Har bir chat uchun saqlanadigan sozlamalar. */
type ChatSettings = Partial<NotebookStyle> & {
  asFile?: boolean;
  /** Hozir ko'rsatilgan menyu (tugmalar shunga mos). */
  menu?: MenuId;
  /** Shrift varaqasi sahifasi (0 dan boshlanadi). */
  fontPage?: number;
  /** Faol shaxsiy uslub id'si ("uslubimni nusxalash"). */
  styleId?: string;
  /** Namunaning qaysi qadami kutilmoqda (matn emas, rasm). */
  styleStep?: StyleStep;
  /** So'zlar namunasining o'lchovlari (raqamlar namunasi kelguncha saqlanadi). */
  styleWords?: SampleProfile;
  /** Nom berilmagan tayyor uslub. */
  styleDraft?: StyleDraft;
  /** Uslub ro'yxatidagi tugma matni → uslub id xaritasi. */
  styleButtons?: Record<string, string>;
  /** Yozish joyini tanlash oqimi (qaysi betning qaysi qatoridan). */
  writeFlow?: WriteFlow;
  /** Yozuvni o'chirish oqimi (qator/so'z bo'yicha). */
  deleteFlow?: DeleteFlow;
  /** Yozish oqimida tanlanadigan qator raqamlari (tugma matnlari). */
  lineButtons?: string[];
  /** O'chirish oqimida tanlanadigan raqamlar (qator yoki so'z raqamlari). */
  numberButtons?: string[];
  /** O'chirish oqimidagi bet tugmalari: tugma matni → bet indeksi. */
  sideButtons?: Record<string, number>;
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
  cardEdit: "🛠 Tahrirlash",
  cardRename: "✏️ Nomini o'zgartirish",
  editDelete: "✂️ Yozuvni o'chirish",
  editUndo: "↩️ Oxirgi amalni qaytarish",
  writeContinue: "▶️ Davom etish",
  writeUnder: "⬇️ Yozuvning tagidan",
  writeNewSide: "➕ Yangi betdan",
  writePickLine: "🔢 Qatorni tanlash",
  writeUndo: "↩️ Yozuvni orqaga qaytarish",
  deleteConfirm: "✅ Ha, o'chirish",
  deleteCancel: "❌ Bekor qilish",
  skipName: "⏭ Nomsiz qoldirish",
  // "Uslubimni nusxalash" bo'limi.
  styleCopy: "🖋 Uslubimni nusxalash",
  styleStart: "▶️ Namunani boshlash",
  styleSkipDigits: "⏭ Raqamlarsiz davom etish",
  styleCancel: "❌ Bekor qilish",
  styleStop: "⏹ Uslubni to'xtatish",
  styleDelete: "🗑 Uslubni o'chirish",
  // Telegram Mini App (Studio) tugmasi.
  studio: "🖥 Studio (Mini App)",
  // Tezkor buyruqlar ro'yxati o'rniga: pastdagi menyudagi tugmalar.
  help: "ℹ️ Yordam",
  chatId: "🆔 Chat ID",
} as const;

/** Namunada yoziladigan so'zlar (har xil harflar uchun 10 ta). */
const STYLE_SAMPLE_WORDS = [
  "salom",
  "maktab",
  "daftar",
  "kitob",
  "qalam",
  "yozuv",
  "o'qituvchi",
  "do'stlik",
  "quyosh",
  "bahor",
];
/** Namunada yoziladigan raqamlar (katak daftarda). */
const STYLE_SAMPLE_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

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

/**
 * Yangi daftar yaratishda tanlanadigan qog'oz turlari.
 *
 * Tugma matni sozlamalardagi qog'oz tugmalaridan farq qiladi (ular `PAPER_SHORT`
 * bilan belgilanadi) — shunda yaratish bosqichida bosilgan tugma sozlama
 * menyusidagi bilan aralashib ketmaydi.
 */
const NEWBOOK_PAPERS: { text: string; paper: PaperType }[] = [
  { text: "📏 Yo'l-yo'l daftar", paper: "lined" },
  { text: "🔲 Katak daftar", paper: "grid" },
  { text: "📄 Oq qog'oz", paper: "plain" },
];

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

/** Varaq formatlari — Mini App'dan kelgan qiymatlarni tekshirish uchun. */
const PAGE_FORMAT_IDS: PageFormat[] = PAGE_FORMAT_OPTIONS.map((option) => option.id);
/** CORS uchun qo'shimcha ruxsat etilgan manbalar (`MINI_APP_ALLOW_ORIGINS`). */
const MINI_APP_EXTRA_ORIGINS = (process.env.MINI_APP_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

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

/**
 * Qo'llanma matni. Funksiya — chunki Studio qatori faqat Mini App manzili
 * (`MINI_APP_URL`) sozlangan o'rnatishlarda qo'shiladi: mavjud bo'lmagan tugma
 * haqida gapirmaymiz. Mini App'ni ulash bo'yicha texnik ko'rsatmalar bu yerda
 * yo'q — ular bot egasi uchun (`deploy/README.md`).
 */
function helpText(): string {
  return [
    "📓 Daftar Bot — matningizni haqiqiy daftar varaqasidek qo'lda yozib beraman.",
    "",
    "Hammasi tugmalarda — buyruq yodlash shart emas:",
    `• ${L.text} — yozishni boshlash (daftar tanlanadi)`,
    `• ${L.settings} ichida: 🖋 siyoh rangi (10 xil), 📄 qog'oz turi (yo'l-yo'l,`,
    `  katak, oq qog'oz), ${L.font} (${FONT_LIBRARY.length} shrift, rasm ko'rinishida),`,
    "  📐 yozuv sozlamalari (o'lcham, qator oralig'i, qo'l tebranishi, matematika,",
    "  yuborish turi) va 📚 daftarlar (yozish, tahrirlash, PDF kitob, nomini o'zgartirish),",
    `• ${L.styleCopy} — o'z qo'lyozmangizni nusxalash,`,
    `• ${L.help} — shu qo'llanma, ${L.chatId} — chat raqamingiz,`,
    ...(miniAppUrl()
      ? [`• ${L.studio} — chat menyusidagi tugma bilan ochib, natijani chatga yuborasiz.`]
      : []),
    "",
    "O'z qo'l yozuvingiz: 🖋 Uslubimni nusxalash — 10 ta so'zni yo'l-yo'l daftarga,",
    "10 ta raqamni katak daftarga yozib suratga olasiz; bot uslubni o'lchab, faqat",
    "sizga ko'rinadigan shaxsiy uslub qilib saqlaydi.",
    "",
    "Daftarlar: ➕ Yangi daftar (12/36/48/96 varaq) — so'ng qog'oz turi (yo'l-yo'l,",
    "katak yoki oq qog'oz) va nom tanlanadi; tanlangan qog'oz daftarda saqlanadi.",
    "Yozgan matningiz varaq-tomonga ketma-ket tushadi: old tomonda chegara chapda,",
    "orqa tomonda — o'ngda.",
    "",
    "Matematika yozuvi:",
    "• daraja: x^2, x^{10}",
    "• indeks: a_1, a_{n+1}",
    "• kasr: \\frac{a}{b} yoki $a/b$",
    "• ildiz: \\sqrt{x} yoki √x",
    "• belgilar: × ÷ ± ≤ ≥ ≠ ∞ π ∑ ∫ √ ° ∠ ⊥ ∈ ∪ ∩",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Sozlamalar ombori (JSON fayl)                                       */
/* ------------------------------------------------------------------ */

const DATA_DIR = process.env.BOT_DATA_DIR?.trim() || join(process.cwd(), "bot", "data");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

let settingsCache: SettingsMap = {};
let notebookStore: NotebookStore | null = null;
let styleStore: StyleStore | null = null;

/** Daftar bazasi (bir marta ochiladi). */
async function books(): Promise<NotebookStore> {
  if (!notebookStore) notebookStore = await createStore(DATA_DIR);
  return notebookStore;
}

/** Shaxsiy uslublar bazasi (bir marta ochiladi). */
async function styles(): Promise<StyleStore> {
  if (!styleStore) styleStore = await createStyleStore(DATA_DIR);
  return styleStore;
}

/**
 * Faol shaxsiy uslub — faqat egasiga qaytariladi.
 *
 * `styleFor()` sinxron bo'lishi kerak (u ko'p joyda chaqiriladi), shuning uchun
 * baza ishga tushishda bir marta yuklanadi (`main()` ga qarang).
 */
function activeStyle(chatId: number): StyleRecord | undefined {
  const id = rawSettings(chatId).styleId;
  if (!id || !styleStore) return undefined;
  return styleStore.get(chatId, id);
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
  const base: NotebookStyle = {
    ...DEFAULT_STYLE,
    ...chat,
    font,
    seed: (DEFAULT_STYLE.seed + Math.abs(chatId)) % 9973,
  };

  // Faol shaxsiy uslub bo'lsa — u o'z shrifti va o'lchovlari bilan qo'llanadi.
  // Uslub faqat egasiga qaytadi, ommaviy shriftlar esa o'z holida qoladi.
  const personal = activeStyle(chatId);
  if (!personal) return { ...base, personal: undefined };
  return {
    ...base,
    font: personal.baseFont,
    wobble: personal.personal.wobble,
    personal: personal.personal,
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

let miniAppUrlCache: string | undefined | null = null;

/**
 * Studio Mini App manzili (`MINI_APP_URL`).
 *
 * Telegram `web_app` tugmasi uchun faqat **HTTPS** manzilni qabul qiladi,
 * shuning uchun `http://` berilgan bo'lsa tugma qo'shilmaydi va bir marta
 * ogohlantirish chiqadi (qiymat `MINI_APP_URL=https://domen.uz/studio`).
 */
function miniAppUrl(): string | undefined {
  if (miniAppUrlCache !== null) return miniAppUrlCache;

  const raw = process.env.MINI_APP_URL?.trim().replace(/\/+$/, "");
  if (!raw) {
    miniAppUrlCache = undefined;
    return undefined;
  }
  if (!/^https:\/\//i.test(raw)) {
    console.warn(
      `⚠️  MINI_APP_URL HTTPS bo'lishi kerak (hozir: ${raw}) — Studio tugmasi qo'shilmadi.`,
    );
    miniAppUrlCache = undefined;
    return undefined;
  }
  miniAppUrlCache = raw;
  return raw;
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

/** Tugma tavsifini Telegram kutgan obyektga aylantiradi. */
function button(spec: ButtonSpec): TgKeyboardButton {
  return typeof spec === "string" ? { text: spec } : { text: spec.text, web_app: { url: spec.webApp } };
}

/** Pastdagi klaviaturani yasaydi (tugmalar matni bilan). */
function reply(rows: ButtonSpec[][]): TgMarkup {
  return {
    keyboard: rows.map((row) => row.map(button)),
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Studio'ni Mini App sifatida ochadigan inline tugma (sozlanmagan bo'lsa — yo'q). */
function studioMarkup(): TgMarkup | undefined {
  const url = miniAppUrl();
  if (!url) return undefined;
  return { inline_keyboard: [[button({ text: `🖥 ${L.studio}`, webApp: url })]] };
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
  const rows: ButtonSpec[][] = [
    [L.text, L.settings],
    // Yordam va chat ID — buyruqlar ro'yxati o'rniga tugma bo'lib turadi.
    [L.help, L.chatId],
  ];
  // Mini App sozlangan bo'lsa — Studio pastdagi menyudan ham ochiladi.
  const studio = miniAppUrl();
  if (studio) rows.push([{ text: L.studio, webApp: studio }]);
  return reply(rows);
}

function settingsKeyboard(): TgMarkup {
  return reply([
    [L.ink, L.paper],
    [L.font, L.writing],
    [L.books, L.styleCopy],
    [L.backMain],
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

/** Daftar kartasi tugmalari: yozish, yuklab olish, tahrirlash, nom almashtirish. */
function cardKeyboard(): TgMarkup {
  return reply([[L.cardWrite], [L.cardDownload], [L.cardEdit, L.cardRename], [L.backBooks]]);
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
    `• Qog'oz: ${PAPER_LABEL[notebook.paper]}`,
    "",
    `Amalni tanlang: ${L.cardWrite}, ${L.cardDownload}, ${L.cardEdit} yoki ${L.cardRename}.`,
  ].join("\n");
}

function newBookKeyboard(): TgMarkup {
  return reply([
    [SHEET_BUTTONS[0].text, SHEET_BUTTONS[1].text],
    [SHEET_BUTTONS[2].text, SHEET_BUTTONS[3].text],
    [L.backBooks],
  ]);
}

/** Yangi daftar uchun qog'oz turi tugmalari (varaq sonidan keyin so'raladi). */
function newBookPaperKeyboard(): TgMarkup {
  return reply([...NEWBOOK_PAPERS.map((option) => [option.text]), [L.backBooks]]);
}

/* ------------------------------------------------------------------ */
/* Uslubimni nusxalash: tugmalar va matnlar                             */
/* ------------------------------------------------------------------ */

/** Chatning shaxsiy uslub holati (matnlarda ko'rsatiladi). */
function styleStatus(chatId: number): string {
  const record = activeStyle(chatId);
  if (record) return `«${record.name}» — o'z qo'lyozmangiz`;
  const saved = styleStore?.list(chatId).length ?? 0;
  return saved > 0 ? `ommaviy shriftlar (${saved} ta saqlangan uslub)` : "ommaviy shriftlar";
}

/** Bir nechta uslub bo'lganda qaysi birini o'chirish so'raladi. */
function deletePickerText(list: { name: string }[]): string {
  return [
    "🗑 Qaysi uslubni o'chiray?",
    "",
    ...list.map((record) => `• ✒️ ${record.name}`),
    "",
    "O'chirilgan uslubni qaytarib bo'lmaydi — kerak bo'lsa namunani qaytadan olish mumkin.",
    `Bekor qilish uchun ${L.styleCancel} tugmasini bosing.`,
  ].join("\n");
}

/** O'chirilgandan keyingi xabar (bazada qolgan uslublar soni bilan). */
function styleDeletedText(name: string, left: number): string {
  return [
    `🗑 «${name}» uslubi o'chirildi.`,
    left > 0
      ? `Bazada yana ${left} ta uslub qoldi — kerak bo'lsa ro'yxatdan tanlang.`
      : `Boshqa saqlangan uslub yo'q. Yangisini ${L.styleStart} bilan olish mumkin.`,
  ].join("\n");
}

/**
 * Uslub bo'limining tugmalari.
 *
 * Namuna olish paytida faqat qadamga mos tugmalar ko'rsatiladi; o'chirish
 * tanlovida esa har bir saqlangan uslub uchun `🗑 <nom>` tugmasi chiqadi. Aks
 * holda saqlangan uslublar ro'yxati (bosing — yoqiladi), namuna boshlash va
 * o'chirish tugmalari chiqadi. Saqlangan uslub tugmalarining matni → id xaritasi
 * sozlamalarga yoziladi (daftarlardagidek), chunki nomlar takrorlanishi mumkin.
 */
function styleKeyboard(chatId: number): TgMarkup {
  const step = rawSettings(chatId).styleStep;
  if (step === "words") return reply([[L.styleCancel]]);
  if (step === "digits") return reply([[L.styleSkipDigits], [L.styleCancel]]);

  // O'chirish tanlovi: har bir saqlangan uslub alohida tugma bo'ladi.
  if (step === "delete") {
    const saved = styleStore?.list(chatId) ?? [];
    return reply([...saved.map((record) => [`🗑 ${record.name}`]), [L.styleCancel]]);
  }

  const list = styleStore?.list(chatId) ?? [];
  const active = activeStyle(chatId);
  const rows: string[][] = [];

  for (let index = 0; index < list.length; index += 2) {
    rows.push(list.slice(index, index + 2).map((record) => mark(record.id === active?.id, `✒️ ${record.name}`)));
  }

  rows.push([L.styleStart]);
  if (active) rows.push([L.styleStop]);
  if (list.length > 0) rows.push([L.styleDelete]);
  rows.push([L.backSettings]);

  // Tugma matni → uslub id xaritasi. `updateSettings` sozlamalar keshini
  // sinxron yangilaydi (saqlash esa fonda ketadi), shuning uchun klaviaturani
  // darhol qaytarish mumkin.
  const map: Record<string, string> = {};
  for (const record of list) map[`✒️ ${record.name}`] = record.id;
  void updateSettings(chatId, { styleButtons: map });
  return reply(rows);
}

/** Uslub bo'limining tavsifi + saqlangan uslublar ro'yxati. */
function styleText(chatId: number): string {
  const list = styleStore?.list(chatId) ?? [];
  const active = activeStyle(chatId);
  return [
    "🖋 Uslubimni nusxalash",
    "",
    "Namunangiz o'lchanadi va bot eng yaqin qo'lyozmani tanlab, uni sizning",
    "qo'lingizga moslaydi (qiyalik, qalinlik, kenglik, harflar orasi).",
    "",
    `Holat: ${styleStatus(chatId)}`,
    ...(list.length > 0
      ? [
          "",
          `Saqlangan uslublar (${list.length}/${MAX_STYLES_PER_CHAT}):`,
          ...list.map((record) => `• ✒️ ${record.name} — ${displayName(record.baseFont)}${record.summary ? ` • ${record.summary}` : ""}`),
          ...(list.length >= MAX_STYLES_PER_CHAT
            ? [
                "",
                `Ko'pi bilan ${MAX_STYLES_PER_CHAT} ta uslub saqlanadi — yangisiga joy ochish uchun keraksizini ${L.styleDelete} bilan o'chirib tashlang.`,
              ]
            : []),
        ]
      : []),
    "",
    "Qanday ishlaydi:",
    "1️⃣ Yo'l-yo'l daftarga 10 ta so'z yozib, suratga oling.",
    "2️⃣ Katak daftarga 10 ta raqam yozib, suratga oling (bu qadamni o'tkazib yuborsa ham bo'ladi).",
    "3️⃣ Uslubga nom bering — u saqlanadi va faqat sizga ko'rinadi.",
    "",
    active
      ? `Hozir «${active.name}» uslubi yoniq. Ro'yxatdan boshqasini tanlashingiz yoki ${L.styleStop} tugmasini bosishingiz mumkin.`
      : `Boshlash uchun ${L.styleStart} tugmasini bosing.`,
    `Hamma uchun ochiq shriftlar ${L.font} bo'limida o'zgarmagan holda turadi.`,
  ].join("\n");
}

/** 1-qadam: so'zlarni yozish ko'rsatmasi. */
function styleWordsText(): string {
  return [
    "🖋 1-qadam: so'zlar namunasi",
    "",
    "Yo'l-yo'l daftar varag'iga quyidagi 10 ta so'zni yozing:",
    STYLE_SAMPLE_WORDS.join(", "),
    "",
    "✍️ Iloji bo'lsa yozuvingizni o'zgartirmasdan, odatdagidek yozing — chiroyli qilib",
    "ko'chirish shart emas, aksincha asl yozuv tabiiyroq chiqadi.",
    "So'zlarni ikki-uch satrga bo'lib yozsangiz o'lchov aniqroq bo'ladi.",
    "📷 Varaq to'rt burchagi bilan ko'rinadigan qilib, yorug' joyda suratga oling.",
    "Suratni shu chatga yuboring.",
  ].join("\n");
}

/** 2-qadam: raqamlarni yozish ko'rsatmasi. */
function styleDigitsText(): string {
  return [
    "✅ So'zlar namunasi o'lchandi.",
    "",
    "🖋 2-qadam: raqamlar namunasi",
    "",
    "Katak daftar varag'iga quyidagi 10 ta raqamni yozing:",
    STYLE_SAMPLE_DIGITS.join("  "),
    "",
    "Raqamlar shtrix qalinligi va yozuv o'lchamini aniqroq o'lchashga yordam beradi.",
    `Raqamlarni yozmasangiz ham bo'ladi — ${L.styleSkipDigits} tugmasini bosing.`,
    "📷 Yozilgan varaqni suratga olib yuboring.",
  ].join("\n");
}

/** Chatda band bo'lmagan uslub nomi. */
function uniqueStyleName(list: StyleRecord[], wanted: string): string {
  const taken = new Set(list.map((record) => record.name));
  if (!taken.has(wanted)) return wanted;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${wanted} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${wanted} (${Date.now() % 1000})`;
}

/** Nomsiz qoldirilganda beriladigan uslub nomi. */
function defaultStyleName(list: StyleRecord[]): string {
  const taken = new Set(list.map((record) => record.name));
  for (let index = 1; index < 100; index += 1) {
    const candidate = index === 1 ? "Mening uslubim" : `Mening uslubim ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "Mening uslubim";
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
    "",
    `🖋 ${L.styleCopy} — 10 ta so'z va 10 ta raqamni yozib suratga olasiz, bot`,
    "o'lchab, sizning qo'lyozmangizga mos shaxsiy uslub yasaydi.",
    "",
    `${L.help} tugmasida qisqa qo'llanma bor — buyruqlarni yodlash shart emas.`,
    ...(miniAppUrl()
      ? [
          "",
          `🖥 ${L.studio} — Studio'ni Telegram ichida ochib, matnni yozasiz;`,
          "natija «Chatga yuborish» tugmasi bilan shu chatga qaytadi.",
        ]
      : []),
  ].join("\n");
}

/**
 * `/studio` buyrug'i matni: Mini App sozlangan bo'lsa tugma orqali ochishni
 * aytadi, aks holda funksiya hozircha yo'qligini bildiradi.
 *
 * Mini App'ni **ulash** bo'yicha texnik ko'rsatmalar (env, nginx) bu yerda yo'q:
 * ular foydalanuvchiga emas, bot egasiga tegishli (`deploy/README.md`).
 *
 * Manzil matn ichida TAKRORLANMAYDI: uni xabar ostidagi `web_app` tugmasi olib
 * yuradi (matnda ham havola bo'lsa xabar uzun va chigal ko'rinadi). `url`
 * parametri faqat tekshiruv uchun beriladi — standart qiymat `MINI_APP_URL`.
 */
export function studioText(url: string | undefined = miniAppUrl()): string {
  if (!url) {
    return [
      "🖥 Studio (Mini App) hozircha mavjud emas.",
      "",
      `Matn yozish uchun ${L.text} tugmasidan foydalanasiz.`,
    ].join("\n");
  }
  return [
    "🖥 Studio (Mini App) — Telegram ichida ochiladigan daftar muharriri.",
    "",
    "Matnni yozasiz, varaqni darhol ko'rasiz va «Chatga yuborish» tugmasi bilan",
    "natija shu chatga varaqa bo'lib keladi.",
    "",
    "Ochish uchun quyidagi tugmani bosing (yoki pastdagi menyudagi 🖥 Studio tugmasini).",
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
    `• Uslub: ${styleStatus(chatId)}`,
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
    "Bu tanlov daftarsiz varaqalar uchun (masalan, Mini App'dan yuborilganda).",
    "Daftar ichida uning o'z qog'ozi ishlatiladi — u daftar yaratishda tanlanadi.",
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
    case "style":
      await sendMessage(chatId, styleText(chatId), styleKeyboard(chatId));
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

/**
 * Daftar beti uchun uslub: qog'oz turi **daftarning o'zida** saqlanadi, shuning
 * uchun u chat sozlamasidagi qog'ozdan ustun turadi (bir chatda yo'l-yo'l va
 * katak daftar birga bo'lishi mumkin).
 */
function notebookStyle(chatId: number, notebook: Notebook, sideIndex: number): NotebookStyle {
  return { ...sideStyle(chatId, sideIndex), paper: notebook.paper };
}

/** Bitta tomonni chizib, foydalanuvchiga yuboradi. */
async function sendSide(chatId: number, notebook: Notebook, sideIndex: number): Promise<void> {
  const store = await books();
  const side = notebook.sides[sideIndex];
  if (!side || side.text.trim().length === 0) return;

  const style = notebookStyle(chatId, notebook, sideIndex);
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

/** Sonni butun songa keltirib, berilgan chegaraga qisqartiradi. */
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Studio (Mini App) yuborgan sozlamalarni tekshiradi.
 *
 * Faqat ma'lum kalitlar qabul qilinadi: `personal` va `startSide` kabi bot
 * o'zi boshqaradigan maydonlarga Mini App tegmaydi, noto'g'ri qiymatlar esa
 * chegaraga qisqartiriladi yoki tashlab yuboriladi.
 */
function sanitizeStudioStyle(raw: unknown): ChatSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const style: ChatSettings = {};

  if (typeof input.paper === "string" && (PAPER_IDS as string[]).includes(input.paper)) {
    style.paper = input.paper as PaperType;
  }
  if (typeof input.ink === "string" && (INK_IDS as string[]).includes(input.ink)) {
    style.ink = input.ink as InkColor;
  }
  if (typeof input.font === "string") {
    const entry = fontEntry(input.font);
    if (entry) style.font = entry.id;
  }
  if (typeof input.fontSize === "number" && Number.isFinite(input.fontSize)) {
    style.fontSize = clampNumber(input.fontSize, SIZE_MIN, SIZE_MAX);
  }
  if (typeof input.lineGap === "number" && Number.isFinite(input.lineGap)) {
    style.lineGap = clampNumber(input.lineGap, 30, 120);
  }
  if (typeof input.marginLeft === "number" && Number.isFinite(input.marginLeft)) {
    style.marginLeft = clampNumber(input.marginLeft, 40, 260);
  }
  if (typeof input.wobble === "number" && Number.isFinite(input.wobble)) {
    style.wobble = Math.min(1, Math.max(0, input.wobble));
  }
  if (typeof input.seed === "number" && Number.isFinite(input.seed)) {
    style.seed = clampNumber(input.seed, 0, 999_999);
  }
  if (typeof input.marginLine === "boolean") style.marginLine = input.marginLine;
  if (typeof input.mathMode === "boolean") style.mathMode = input.mathMode;
  if (
    typeof input.pageFormat === "string" &&
    (PAGE_FORMAT_IDS as string[]).includes(input.pageFormat)
  ) {
    style.pageFormat = input.pageFormat as PageFormat;
  }
  return style;
}

/**
 * Daftarning joriy yozish joyi: qaysi betga va qaysi qatordan davom etadi.
 *
 * Botdagi «joy tanlash» bilan bir xil qoida: oxirgi betda bo'sh joy bo'lsa —
 * o'sha bet, aks holda yangi betning 1-qatori. Studio shu ma'lumot asosida
 * varaqani chizib, qatorni tanlash imkonini beradi.
 */
async function miniAppPosition(chatId: number, notebook: Notebook): Promise<MiniAppSideInfo> {
  const store = await books();
  const usedSides = store.usedSides(notebook);
  const lastSide = usedSides - 1;
  const lastMeasure =
    lastSide >= 0 ? await measureSide(chatId, lastSide, notebook.sides[lastSide].text) : undefined;
  const startNewSide = usedSides === 0 || !lastMeasure || lastMeasure.freeLines <= 0;
  const sideIndex = startNewSide ? usedSides : lastSide;
  const style = styleFor(chatId);
  const linesPerPage = lastMeasure?.linesPerPage ?? linesPerPageFor(style.pageFormat, style.lineGap);

  if (startNewSide) {
    return {
      sideIndex,
      sideCount: usedSides,
      text: "",
      linesPerPage,
      usedLines: 0,
      nextLine: 1,
      freeLines: linesPerPage,
    };
  }

  const usedLines = lastMeasure?.lines.length ?? 0;
  return {
    sideIndex,
    sideCount: usedSides,
    text: notebook.sides[sideIndex]?.text ?? "",
    linesPerPage,
    usedLines,
    nextLine: Math.min(linesPerPage, usedLines + 1),
    freeLines: lastMeasure?.freeLines ?? 0,
  };
}

/**
 * `POST /mini-app/state`: Studio yozishdan oldin daftar tanlashi va joriy
 * betni ko'rishi uchun ma'lumot. `notebookId` berilsa — o'sha daftar chatda
 * ochiq qilib qo'yiladi (botdagi «ochiq daftar» sozlamasi bilan bir xil).
 */
async function miniAppState(request: MiniAppStateRequest): Promise<MiniAppState> {
  const chatId = request.chatId;
  const store = await books();

  const wanted = request.notebookId ? store.get(request.notebookId) : undefined;
  if (wanted && wanted.chatId === chatId) await updateSettings(chatId, { notebookId: wanted.id });

  const list = store.list(chatId);
  const active = rawSettings(chatId).notebookId;
  const activeId = active && list.some((notebook) => notebook.id === active) ? active : null;
  const notebook = activeId ? store.get(activeId) : undefined;

  const notebooks: MiniAppNotebookInfo[] = list.map((entry) => ({
    id: entry.id,
    title: entry.title,
    sheets: entry.sheets,
    paper: entry.paper,
    usedSides: store.usedSides(entry),
    capacity: store.capacity(entry),
    active: entry.id === activeId,
  }));

  if (!notebook) {
    return { notebooks, activeId: null, side: null, style: styleFor(chatId) };
  }

  const side = await miniAppPosition(chatId, notebook);
  const renderSide = Math.max(0, Math.min(side.sideIndex, store.usedSides(notebook) - 1));
  return {
    notebooks,
    activeId,
    side,
    style: notebookStyle(chatId, notebook, renderSide),
  };
}

/**
 * Studio (Mini App) yuborgan matnni chatga qaytaradi.
 *
 * Chatda ochiq daftar bo'lsa — botdagi kabi o'sha daftarga yozamiz (baza va
 * ↩️ orqaga qaytarish tarixi ham ishlaydi). Studio `notebookId` va `startLine`
 * yuborsa, matn aynan o'sha daftarning o'sha qatoridan boshlab yoziladi.
 * Daftar bo'lmasa, varaqalar shu chat uslubida chizilib, to'g'ridan-to'g'ri
 * chatga yuboriladi.
 */
async function sendMiniAppText(request: MiniAppRequest): Promise<MiniAppResult> {
  const chatId = request.chatId;
  const style = sanitizeStudioStyle(request.style);
  if (Object.keys(style).length > 0) await updateSettings(chatId, style);

  const store = await books();
  // Studio tanlagan daftar faqat shu chatniki bo'lsa qabul qilinadi.
  const chosen = request.notebookId ? store.get(request.notebookId) : undefined;
  if (chosen && chosen.chatId === chatId) await updateSettings(chatId, { notebookId: chosen.id });

  const activeId = rawSettings(chatId).notebookId;
  const notebook = activeId ? store.get(activeId) : undefined;

  if (notebook && notebook.chatId === chatId) {
    // Studio qatorni tanlagan bo'lsa — `writeFlow` orqali aynan shu betning shu
    // qatoridan boshlaymiz (`writeToNotebook` shu oqimni hurmat qiladi).
    let startAt: { sideIndex: number; line: number } | undefined;
    if (typeof request.startLine === "number" && Number.isFinite(request.startLine)) {
      const position = await miniAppPosition(chatId, notebook);
      const line = Math.min(position.linesPerPage, Math.max(1, Math.floor(request.startLine)));
      startAt = { sideIndex: position.sideIndex, line };
      await updateSettings(chatId, {
        writeFlow: {
          notebookId: notebook.id,
          sideIndex: position.sideIndex,
          line,
          stage: "ready",
        },
      });
    }

    const before = store.usedSides(notebook);
    await writeToNotebook(chatId, request.text);
    const after = store.usedSides(store.get(notebook.id) as Notebook);
    return {
      mode: "notebook",
      pages: Math.max(0, after - before),
      notebook: notebook.title,
      ...(startAt ? { side: startAt.sideIndex, line: startAt.line } : {}),
    };
  }

  const activeStyle = styleFor(chatId);
  const fonts = await fontsFor(activeStyle);
  if (Object.keys(fonts).length === 0) throw new Error("shrift fayllari topilmadi");

  const result = await renderNotebook({ text: request.text, style: activeStyle, fonts });
  const pages = result.pages.slice(0, MAX_RENDER_PAGES);
  if (pages.length === 0) throw new Error("varaqa chizilmadi");

  await tg("sendChatAction", { chat_id: chatId, action: "upload_photo" }).catch(() => undefined);

  const notes: string[] = ["🖥 Studio'dan yuborildi."];
  if (result.pages.length > MAX_RENDER_PAGES) {
    notes.push(`Faqat birinchi ${MAX_RENDER_PAGES} varaqa yuborildi.`);
  }
  if (CYRILLIC_RE.test(request.text) && !fontSupportsCyrillic(activeStyle.font)) {
    notes.push("Bu shrift kirillcha harflarni bilmaydi — ular zaxira shriftda chizildi.");
  }
  for (const warning of result.warnings) notes.push(warning);

  const caption = [
    `📄 ${PAPER_SHORT[activeStyle.paper]} • ${INK_LABEL[activeStyle.ink]} • ${displayName(activeStyle.font)}`,
    ...notes,
  ].join("\n");

  for (let index = 0; index < pages.length; index += 1) {
    await sendPng(chatId, pages[index].png, {
      asFile: isFileMode(chatId),
      filename: `studio-${index + 1}.png`,
      caption: index === 0 ? caption : undefined,
      markup: index === 0 ? mainKeyboard() : undefined,
    });
  }

  return { mode: "pages", pages: pages.length, notebook: null };
}

/**
 * `POST /mini-app/notebook`: chatdagi daftarni Mini App'dan boshqaradi.
 *
 * Bot chatidagi tugmalar bilan bir xil ishni qiladi — yangi daftar yaratish
 * (varaq soni va qog'oz turini tanlab), nomini almashtirish, o'chirish, oxirgi
 * tahrirni orqaga qaytarish va yozilgan betlarni PDF kitob qilib yuborish.
 *
 * Amalning natijasi qisqa xabar bo'lib qaytadi (Studio uni ko'rsatadi); chatga
 * faqat kitob yuboriladi — qolgan amallar jimgina bajariladi, chunki ularni
 * foydalanuvchi Mini App'ning o'zida ko'radi.
 */
async function miniAppNotebook(request: MiniAppNotebookRequest): Promise<MiniAppNotebookResult> {
  const chatId = request.chatId;
  const store = await books();

  // Faqat shu chatning daftari ustida ishlaymiz: begona id jimgina rad etiladi.
  const owned = (id: string | undefined): Notebook | undefined => {
    const notebook = id ? store.get(id) : undefined;
    return notebook && notebook.chatId === chatId ? notebook : undefined;
  };

  if (request.action === "create") {
    const sheets = SHEET_CHOICES.find((choice) => choice === request.sheets);
    if (!sheets) return { ok: false, message: "Varaq soni 12, 36, 48 yoki 96 bo'lishi kerak." };

    const paper = PAPER_CHOICES.find((choice) => choice === request.paper) ?? "lined";
    const list = store.list(chatId);
    const wanted = request.title ? cleanTitle(request.title) : null;
    if (request.title && !wanted) {
      return { ok: false, message: "Nom bo'sh bo'lmasligi kerak — boshqa nom yozib ko'ring." };
    }

    const notebook = await store.create({
      chatId,
      sheets,
      paper,
      title: uniqueTitle(list, wanted ?? defaultBookTitle(list)),
    });
    // Yangi daftar darhol ochiq bo'ladi — chatdagi «➕ Yangi daftar» kabi.
    await updateSettings(chatId, { notebookId: notebook.id });
    return {
      ok: true,
      notebookId: notebook.id,
      title: notebook.title,
      message: `✅ «${notebook.title}» yaratildi — ${notebook.sheets} varaq (${store.capacity(
        notebook,
      )} bet), ${PAPER_LABEL[notebook.paper]}.`,
    };
  }

  const notebook = owned(request.notebookId);
  if (!notebook) {
    return { ok: false, message: "Daftar topilmadi — ro'yxatni yangilab, qaytadan urinib ko'ring." };
  }

  if (request.action === "rename") {
    const cleaned = request.title ? cleanTitle(request.title) : null;
    if (!cleaned) return { ok: false, message: "Nom bo'sh bo'lmasligi kerak — boshqa nom yozib ko'ring." };

    const next = uniqueTitle(store.list(chatId), cleaned, notebook.id);
    if (!(await store.rename(notebook.id, next))) {
      return { ok: false, message: "Nomni o'zgartirib bo'lmadi. Keyinroq urinib ko'ring. 🙏" };
    }
    const updated = store.get(notebook.id) as Notebook;
    return {
      ok: true,
      notebookId: updated.id,
      title: updated.title,
      message: `✏️ Daftar nomi o'zgartirildi: «${updated.title}».`,
    };
  }

  if (request.action === "remove") {
    if (!(await store.remove(notebook.id))) {
      return { ok: false, message: "Daftarni o'chirib bo'lmadi. Keyinroq urinib ko'ring. 🙏" };
    }
    // O'chirilgan daftarga ishora qilgan sozlamalar ham tozalanadi.
    const chat = rawSettings(chatId);
    await updateSettings(chatId, {
      ...(chat.notebookId === notebook.id ? { notebookId: undefined } : {}),
      ...(chat.cardId === notebook.id ? { cardId: undefined } : {}),
      ...(chat.writeFlow?.notebookId === notebook.id ? { writeFlow: undefined } : {}),
      ...(chat.deleteFlow?.notebookId === notebook.id ? { deleteFlow: undefined } : {}),
      ...(chat.pending?.kind === "rename" && chat.pending.id === notebook.id ? { pending: undefined } : {}),
    });
    store.setActive(chatId, null);
    return { ok: true, notebookId: null, title: null, message: `🗑 «${notebook.title}» o'chirildi.` };
  }

  // `undo`: daftar avvalgi holatiga qaytadi, natijani Mini App o'zi ko'rsatadi
  // (holat so'rovi bet matnini qayta o'qiydi) — chatga bet yuborilmaydi.
  if (request.action === "undo") {
    const edit = await store.undo(notebook.id);
    if (!edit) return { ok: false, message: "Orqaga qaytarish uchun tahrir amali yo'q." };
    return {
      ok: true,
      notebookId: notebook.id,
      title: notebook.title,
      message: `↩️ «${edit.label}» amali orqaga qaytarildi — daftar avvalgi holatiga keldi.`,
    };
  }

  // `book`: kitob (PDF) aynan shu amalda chatga yetkaziladi.
  await sendNotebookBook(chatId, notebook);
  return {
    ok: true,
    notebookId: notebook.id,
    title: notebook.title,
    message: `📄 «${notebook.title}» kitobi chatga yuborildi.`,
  };
}

/**
 * Joriy tomonga matn yozadi (tomon kerak bo'lsa ochiladi).
 *
 * Yozuv `applySides` orqali yoziladi: shunda oldingi matn tarixga tushadi va
 * foydalanuvchi ↩️ tugmasi bilan yozuvni butunlay orqaga qaytarishi mumkin.
 */
async function writeToSide(notebookId: string, sideIndex: number, text: string): Promise<number | null> {
  const store = await books();
  let index = sideIndex;
  if (index < 0) {
    const created = await store.addSide(notebookId);
    if (!created) return null;
    index = store.usedSides(store.get(notebookId) as Notebook) - 1;
  }
  const ok = await store.applySides(notebookId, [{ index, text }], "yozuv");
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

  // Yozish joyi tanlangan bo'lsa (✍️ Shu daftarga yozish → joy tanlash), matn
  // aynan shu betning shu qatoridan boshlab yoziladi.
  const flow = rawSettings(chatId).writeFlow;
  if (flow?.stage === "ready" && flow.notebookId === notebook.id) {
    await writeAtFlow(chatId, notebook, body, flow);
    return;
  }
  // Joy tanlash hali tugallanmagan bo'lsa ham matn yuborilishi mumkin: bunday
  // holda odatdagi tartibda (oxirgi betdan davom etib) yozamiz va eskirgan
  // oqim holatini tozalaymiz.
  if (flow) await updateSettings(chatId, { writeFlow: undefined });

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
  const fonts = await fontsFor(notebookStyle(chatId, notebook, 0));

  while (remaining.length > 0 && written < MAX_SIDES_PER_MESSAGE) {
    const usedSides = store.usedSides(notebook);
    const sideIndex = usedSides - 1;
    const base = sideIndex >= 0 ? notebook.sides[sideIndex].text : "";
    const candidate = base.length > 0 ? `${base}\n${remaining}` : remaining;
    const fit = await fitToSingleSide(candidate, {
      style: notebookStyle(chatId, notebook, Math.max(0, sideIndex)),
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
      style: notebookStyle(chatId, notebook, store.usedSides(notebook) - 1),
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

/**
 * Tanlangan betning tanlangan qatoridan yozadi va betdagi bo'sh joyni qayta
 * sanab, foydalanuvchiga qayergacha to'lganini aytadi.
 *
 * Matn bitta betga sig'masa, qolgani keyingi betlardan davom etadi (yozish
 * tugagach ↩️ tugmasi bilan hammasini orqaga qaytarish mumkin).
 */
async function writeAtFlow(chatId: number, notebook: Notebook, text: string, flow: WriteFlow): Promise<void> {
  const store = await books();
  const fonts = await fontsFor(styleFor(chatId));
  const capacity = store.capacity(notebook);
  const used = store.usedSides(notebook);
  const sideIndex = Math.max(0, Math.min(flow.sideIndex, used));
  const line = Math.max(1, flow.line ?? 1);

  // Betning oxirgi yozuvidan keyin `line`-qatorgacha bo'sh joy qoldirib yozamiz.
  const base = notebook.sides[sideIndex]?.text ?? "";
  // Mavjud matn chizilgan varaqada nechta qatorni egallagan (o'ralgan
  // paragraflar ham alohida qator bo'lib sanaladi) — yangi yozuv shundan
  // boshlab sanaladi, aks holda so'ralgan sondan ko'p qator tashlanadi.
  const baseLines = base.trim().length > 0 ? (await measureSide(chatId, sideIndex, base)).lines.length : 0;
  const candidate = appendChunk(base, text, line, baseLines);
  const style = notebookStyle(chatId, notebook, Math.min(sideIndex, Math.max(0, used - 1)));
  const fit = await fitToSingleSide(candidate, { style, fonts });
  const head = fit.fitsEntirely ? candidate : fit.head;
  let rest = fit.fitsEntirely ? "" : fit.tail.trim();

  const changes: { index: number; text: string }[] = [{ index: sideIndex, text: head }];
  const touched: number[] = [sideIndex];
  let index = sideIndex;

  // Qolgan matnni keyingi betlarga joylashtiramiz (mavjud betlar ustidan
  // yozilmaydi — faqat bo'sh joydan keyin qo'shiladi).
  while (rest.length > 0 && index + 1 <= used && index + 1 < capacity) {
    index += 1;
    const previous = index < used ? notebook.sides[index].text : "";
    const attempt = previous.length > 0 ? `${previous}\n${rest}` : rest;
    const nextFit = await fitToSingleSide(attempt, { style: sideStyle(chatId, index), fonts });
    const nextHead = nextFit.fitsEntirely ? attempt : nextFit.head;
    if (nextHead.trim().length === 0) break;
    changes.push({ index, text: nextHead });
    touched.push(index);
    rest = nextFit.fitsEntirely ? "" : nextFit.tail.trim();
  }

  await store.applySides(notebook.id, changes, "yozuv");
  await updateSettings(chatId, { notebookId: notebook.id, writeFlow: undefined });
  const updated = store.get(notebook.id) as Notebook;

  if (head.trim().length === 0) {
    await sendMessage(
      chatId,
      [
        "⚠️ Matn bu betga sig'madi.",
        "",
        "🔢 Qatorni tanlash bilan boshqa qatorni yoki ➕ Yangi betdan bilan yangi betni tanlab ko'ring.",
      ].join("\n"),
      cardKeyboard(),
    );
    return;
  }

  for (const at of touched) await sendSide(chatId, updated, at);

  const measure = await measureSide(chatId, sideIndex, updated.sides[sideIndex]?.text ?? "");
  await sendMessage(
    chatId,
    [
      `✅ «${updated.title}» daftariga yozildi.`,
      `📄 ${sideIndex + 1}-betning ${line}-qatoridan boshlandi — hozir ${measure.lines.length} qator band, tepadan sanaganda ${measure.freeLines} qator bo'sh.`,
      rest.length > 0 ? "⚠️ Matn juda uzun edi — bir qismi keyingi betga o'tdi, qolganini yana yuboring." : "",
      touched.length > 1 ? `🖼 Yozilgan betlar: ${touched.map((at) => at + 1).join(", ")}` : "",
      "",
      `Yozuv yoqmasa ${L.editUndo} bilan orqaga qaytaring yoki 🛠 Tahrirlash → ${L.editDelete} bilan o'chiring.`,
    ]
      .filter((row) => row.length > 0)
      .join("\n"),
    reply([[L.writeUndo], [L.cardEdit], [L.backBooks]]),
  );
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

/** Varaq soni tanlangach daftar qog'ozini so'raydi (keyingi qadam — nom). */
async function askBookPaper(chatId: number, sheets: NotebookSheets): Promise<void> {
  await updateSettings(chatId, { pending: { kind: "create", sheets }, menu: "newbook" });
  await sendMessage(
    chatId,
    [
      `📄 ${sheets} varaqli daftar qanday bo'ladi?`,
      "",
      "Qog'oz turini tanlang: yo'l-yo'l (chiziqli), katak yoki oq qog'oz.",
      "Tanlangan tur daftarda saqlanadi — keyingi yozuvlar ham shu qog'ozda chiziladi.",
    ].join("\n"),
    newBookPaperKeyboard(),
  );
}

/** Qog'oz turi tanlangach nom so'raydi (keyingi matn nom bo'ladi). */
async function askBookName(chatId: number, sheets: NotebookSheets, paper: PaperType): Promise<void> {
  const store = await books();
  const suggestion = defaultBookTitle(store.list(chatId));
  await updateSettings(chatId, { pending: { kind: "create", sheets, paper }, menu: "newbook" });
  await sendMessage(
    chatId,
    [
      `✏️ Daftarga nom bering — keyingi xabaringiz nom bo'ladi (masalan: Matematika 8-sinf).`,
      "",
      `📄 Qog'oz: ${PAPER_LABEL[paper]}`,
      `Nom kerak bo'lmasa ${L.skipName} tugmasini bosing: «${suggestion}» nomi bilan yaratiladi.`,
    ].join("\n"),
    reply([[L.skipName], [L.backBooks]]),
  );
}

/** Yangi daftar yaratadi va uni ochadi (nom berilmasa — standart nom). */
async function createNotebook(
  chatId: number,
  sheets: NotebookSheets,
  paper: PaperType,
  title?: string,
): Promise<void> {
  const store = await books();
  const list = store.list(chatId);
  const wanted = (title ? cleanTitle(title) : null) ?? defaultBookTitle(list);
  const notebook = await store.create({ chatId, sheets, paper, title: uniqueTitle(list, wanted) });
  await updateSettings(chatId, { notebookId: notebook.id, menu: "main" });
  await sendMessage(
    chatId,
    [
      `✅ «${notebook.title}» yaratildi — ${sheets} varaq (${sheets * 2} bet), ${PAPER_LABEL[notebook.paper]}.`,
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

  // Kitob ham daftarning o'z qog'ozida chiziladi (yaratishda tanlangan tur).
  const style: NotebookStyle = { ...styleFor(chatId), paper: notebook.paper };
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
/* Yozish joyi: qaysi betning qaysi qatoridan yozamiz                 */
/* ------------------------------------------------------------------ */

/** Bet matnini joriy uslub bilan o'lchaydi (qatorlar, bo'sh joy). */
async function measureSide(chatId: number, sideIndex: number, text: string): Promise<SideTextMeasure> {
  const style = sideStyle(chatId, sideIndex);
  const linesPerPage = linesPerPageFor(style.pageFormat, style.lineGap);
  const fonts = await fontsFor(style);
  const primaryId = fonts[style.font] ? style.font : FALLBACK_FONT_ID;
  const bytes = fonts[primaryId];
  if (!bytes) {
    return { lines: [], words: wordsOf(text), linesPerPage, pages: 0, freeLines: linesPerPage };
  }
  const primary = parseFont(primaryId, bytes);
  const secondary =
    primaryId !== FALLBACK_FONT_ID && fonts[FALLBACK_FONT_ID]
      ? parseFont(FALLBACK_FONT_ID, fonts[FALLBACK_FONT_ID])
      : undefined;
  return measureSideText({
    text,
    style,
    primary,
    secondary,
    sizeScale: fontEntry(primaryId)?.sizeScale ?? 1,
  });
}

/** Betdagi joyni odam o'qiydigan ko'rinishda yozadi. */
function sidePositionText(measure: SideTextMeasure, sideIndex: number): string {
  const sheet = Math.floor(sideIndex / 2) + 1;
  return `📄 ${sideIndex + 1}-bet (${sheet}-varaq, ${sideLabel(sideIndex)}): ${measure.lines.length} qator band, ${measure.freeLines} qator bo'sh`;
}

/** Yozish oqimining tugmalari (bosqichga qarab). */
function writeKeyboard(chatId: number): TgMarkup {
  const flow = rawSettings(chatId).writeFlow;
  if (!flow) return mainKeyboard();
  if (flow.stage === "position") {
    return reply([[L.writeContinue], [L.writePickLine, L.writeNewSide], [L.backBooks]]);
  }
  if (flow.stage === "skip") {
    return reply([
      [L.writeUnder],
      ["⏭ 1", "⏭ 2"],
      ["⏭ 3", "⏭ 5"],
      [L.deleteCancel],
    ]);
  }
  if (flow.stage === "line") {
    const rows: string[][] = [];
    for (const label of rawSettings(chatId).lineButtons ?? []) rows.push([label]);
    rows.push([L.deleteCancel]);
    return reply(rows);
  }
  return reply([[L.deleteCancel], [L.backBooks]]);
}

/**
 * Yozish joyini tanlashni boshlaydi: oxirgi yozilgan joyni ko'rsatadi, betdagi
 * bo'sh qatorlarni sanaydi va qayerdan yozishni so'raydi.
 */
async function openWriteSession(chatId: number, notebook: Notebook, store: NotebookStore): Promise<void> {
  const usedSides = store.usedSides(notebook);
  const lastSide = usedSides - 1;
  const lastMeasure = lastSide >= 0 ? await measureSide(chatId, lastSide, notebook.sides[lastSide].text) : undefined;
  const startNewSide = usedSides === 0 || !lastMeasure || lastMeasure.freeLines <= 0;
  const sideIndex = startNewSide ? usedSides : lastSide;
  const line = startNewSide ? 1 : (lastMeasure as SideTextMeasure).lines.length + 1;

  await updateSettings(chatId, {
    notebookId: notebook.id,
    menu: "main",
    deleteFlow: undefined,
    writeFlow: { notebookId: notebook.id, sideIndex, line, stage: "position" },
  });

  const lines = [
    `✍️ «${notebook.title}» — qayerdan yozamiz?`,
    "",
    usedSides === 0
      ? "Bu daftarda hali yozilgan bet yo'q — birinchi betdan boshlaymiz."
      : `Shu paytgacha ${usedSides} bet yozilgan. Oxirgi yozuv: ${lastSide + 1}-bet, ${lastMeasure?.lines.length ?? 0}-qatorda tugagan.`,
    lastMeasure ? sidePositionText(lastMeasure, lastSide) : "",
    "",
    "Kerakli joyni tanlang:",
    `${L.writeContinue} — ${line}-qatordan davom etadi (${lastMeasure?.freeLines ?? 0} qator bo'sh).`,
    startNewSide ? `${L.writeNewSide} — hozir yangi bet ochiladi.` : `${L.writeNewSide} — keyingi betning 1-qatoridan.`,
    `${L.writePickLine} — shu betdagi bo'sh qatorlardan birini tanlaysiz.`,
  ].filter((row) => row.length > 0);

  await sendMessage(chatId, lines.join("\n"), writeKeyboard(chatId));
}

/** Qator tanlangach (yoki davom etishdan keyin) nechta qator tashlashni so'raydi. */
async function askSkipLines(chatId: number): Promise<void> {
  const flow = rawSettings(chatId).writeFlow;
  if (!flow) return;
  await updateSettings(chatId, { writeFlow: { ...flow, line: flow.line ?? 1, stage: "skip" } });
  await sendMessage(
    chatId,
    [
      "⏭ Nechta qator tashlab ketamiz?",
      "",
      `Yozish ${flow.line ?? 1}-qatordan boshlanadi (tepadan sanaganda).`,
      "",
      `${L.writeUnder} — oldingi yozuvning tagidan, bo'sh qator qoldirmasdan.`,
      "⏭ 1, ⏭ 2 … — shuncha qator bo'sh qoladi (⏭ 1 — bitta qator tashlanadi).",
    ].join("\n"),
    writeKeyboard(chatId),
  );
}

/** Yozish joyini tanlash oqimini yakunlaydi (matn kutiladi). */
async function finishWritePosition(chatId: number): Promise<void> {
  const flow = rawSettings(chatId).writeFlow;
  if (!flow) return;
  await updateSettings(chatId, { writeFlow: { ...flow, stage: "ready" } });
  await sendMessage(
    chatId,
    [
      "✅ Tayyor!",
      "",
      `Yozish ${flow.sideIndex + 1}-betning ${flow.line ?? 1}-qatoridan boshlanadi.`,
      "Endi matn yuboring — uni shu joydan boshlab yozaman.",
    ].join("\n"),
    writeKeyboard(chatId),
  );
}

/** Bo'sh qatorlardan birini tanlashni so'raydi (yozish oqimi). */
async function askWriteLine(chatId: number): Promise<void> {
  const flow = rawSettings(chatId).writeFlow;
  if (!flow) return;
  const store = await books();
  const notebook = store.get(flow.notebookId);
  if (!notebook || notebook.chatId !== chatId) {
    await updateSettings(chatId, { writeFlow: undefined });
    await sendMessage(chatId, "Daftar topilmadi — 📚 Daftarlar bo'limidan qayta tanlang.", mainKeyboard());
    return;
  }

  const measure = await measureSide(chatId, flow.sideIndex, notebook.sides[flow.sideIndex]?.text ?? "");
  const firstFree = Math.min(measure.linesPerPage, measure.lines.length + 1);
  await updateSettings(chatId, {
    lineButtons: lineButtonsFor(firstFree, measure.linesPerPage),
    writeFlow: { ...flow, stage: "line" },
  });
  await sendMessage(
    chatId,
    [
      `🔢 ${flow.sideIndex + 1}-bet — qatorni tanlang`,
      "",
      measure.lines.length > 0
        ? `Tepadan sanaganda ${measure.lines.length} qator band, oxirgi yozuv ${measure.lines.length}-qatorda tugagan.`
        : "Bu bet hali bo'sh.",
      `Bo'sh qatorlar: ${firstFree}..${measure.linesPerPage} (jami ${measure.freeLines} qator toza turibdi).`,
      "",
      "Qaysi qatordan yozamiz? Raqamni tanlang (yoki raqamni yozib yuboring).",
    ].join("\n"),
    writeKeyboard(chatId),
  );
}

/* ------------------------------------------------------------------ */
/* Yozuvni o'chirish va orqaga qaytarish                               */
/* ------------------------------------------------------------------ */

/** Bet/qator/so'z joyini o'qish uchun matn ko'rinishi. */
function pointText(point: SidePoint): string {
  return `${point.side + 1}-betning ${point.line}-qatorining ${point.word}-so'zi`;
}

/** Yozilgan betlarni «slayd» qilib yuboradi va bet tugmalarini qaytaradi. */
async function sendSideSlides(chatId: number, notebook: Notebook, intro: string): Promise<void> {
  const filled = notebook.sides
    .map((side, index) => ({ side, index }))
    .filter((entry) => entry.side.text.trim().length > 0);

  for (const entry of filled.slice(0, 6)) await sendSide(chatId, notebook, entry.index);

  const rows: string[][] = [];
  const map: Record<string, number> = {};
  for (const entry of filled.slice(0, 8)) {
    const measure = await measureSide(chatId, entry.index, entry.side.text);
    const label = `📄 ${entry.index + 1}-bet • ${measure.lines.length} qator`;
    map[label] = entry.index;
    rows.push([label]);
  }
  rows.push([L.deleteCancel]);
  await updateSettings(chatId, { sideButtons: map });
  await sendMessage(
    chatId,
    [intro, "", `Yozilgan betlar: ${filled.length} ta. Betni tanlang:`].join("\n"),
    reply(rows),
  );
}

/** Qator raqamlari tugmalarini tayyorlaydi (ko'pi bilan 12 ta, keyin raqam yoziladi). */
function lineButtonsFor(from: number, to: number): string[] {
  const labels: string[] = [];
  for (let line = from; line <= to && labels.length < 12; line += 1) labels.push(String(line));
  return labels;
}

/** O'chirish oqimining tugmalari (bosqichga qarab). */
function deleteKeyboard(chatId: number): TgMarkup {
  const flow = rawSettings(chatId).deleteFlow;
  if (!flow) return mainKeyboard();
  const settings = rawSettings(chatId);
  if (flow.stage === "confirm") return reply([[L.deleteConfirm], [L.deleteCancel]]);
  if (flow.stage === "startLine" || flow.stage === "endLine" || flow.stage === "startWord" || flow.stage === "endWord") {
    const rows: string[][] = [];
    const labels = settings.numberButtons ?? [];
    for (let index = 0; index < labels.length; index += 4) rows.push(labels.slice(index, index + 4));
    rows.push([L.deleteCancel]);
    return reply(rows);
  }
  const rows: string[][] = [];
  for (const label of Object.keys(settings.sideButtons ?? {})) rows.push([label]);
  rows.push([L.deleteCancel]);
  return reply(rows);
}

/** O'chirish oqimini boshlaydi: yozilgan betlar «slayd» qilib ko'rsatiladi. */
async function startDeleteFlow(chatId: number, notebook: Notebook): Promise<void> {
  const store = await books();
  const filled = store.usedSides(notebook) > 0 && notebook.sides.some((side) => side.text.trim().length > 0);
  if (!filled) {
    await sendMessage(chatId, "Bu daftarda hali yozilgan bet yo'q — o'chiradigan yozuv ham yo'q.", cardKeyboard());
    return;
  }
  await updateSettings(chatId, {
    menu: "edit",
    cardId: notebook.id,
    writeFlow: undefined,
    deleteFlow: { notebookId: notebook.id, stage: "side" },
  });
  await sendSideSlides(
    chatId,
    notebook,
    [
      "✂️ Yozuvni o'chirish",
      "",
      "O'chirish boshlanadigan betni tanlang. Betlar rasmlari tepada yuborildi.",
    ].join("\n"),
  );
}

/** Qator raqamlari so'raladi (o'chirish oqimi). `from` — eng kichik tanlanadigan qator. */
async function askDeleteLine(chatId: number, side: number, from = 1): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow || !notebook) return;
  const measure = await measureSide(chatId, side, notebook.sides[side]?.text ?? "");
  const labels = lineButtonsFor(Math.max(1, from), measure.lines.length);
  await updateSettings(chatId, { numberButtons: labels });
  await sendMessage(
    chatId,
    [
      `📄 ${side + 1}-bet — qatorlar: ${measure.lines.length}`,
      "",
      ...measure.lines.slice(0, 12).map((line) => `${line.index}-qator: ${line.words.slice(0, 8).join(" ")}${line.words.length > 8 ? " …" : ""}`),
      measure.lines.length > 12 ? "…" : "",
      "",
      "O'chirish boshlanadigan qatorning raqamini tanlang (yoki raqamni yozib yuboring).",
    ]
      .filter((row) => row.length > 0)
      .join("\n"),
    deleteKeyboard(chatId),
  );
}

/** Qatordagi so'zlar raqamlari so'raladi (o'chirish oqimining boshlanishi). */
async function askDeleteWord(chatId: number, side: number, line: number, fromWord: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow || !notebook) return;
  const measure = await measureSide(chatId, side, notebook.sides[side]?.text ?? "");
  const target = measure.lines[line - 1];
  const labels = (target?.words ?? [])
    .map((_, index) => index + 1)
    .filter((index) => index >= fromWord)
    .slice(0, 12)
    .map(String);
  await updateSettings(chatId, { numberButtons: labels });
  await sendMessage(
    chatId,
    [
      `🔢 ${side + 1}-betning ${line}-qatoridagi so'zlar:`,
      "",
      ...(target?.words ?? []).map((word, index) => `${index + 1}) ${word}`),
      "",
      "Nechinchi so'zdan boshlab o'chiramiz? Tanlangan so'z ham o'chiriladi (o'z ichiga olinadi).",
    ].join("\n"),
    deleteKeyboard(chatId),
  );
}

/** O'chirish oraliģi tasdiqlashga tayyor bo'lganda ko'rsatiladigan matn. */
async function askDeleteConfirm(chatId: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.start || !flow.end || !notebook) return;

  const preview: string[] = [];
  let count = 0;
  for (let side = flow.start.side; side <= flow.end.side; side += 1) {
    const measure = await measureSide(chatId, side, notebook.sides[side]?.text ?? "");
    const from = side === flow.start.side ? (measure.lines[flow.start.line - 1]?.wordStart ?? 0) + flow.start.word - 1 : 0;
    const to = side === flow.end.side
      ? (measure.lines[flow.end.line - 1]?.wordStart ?? 0) + flow.end.word - 1
      : measure.words.length - 1;
    const slice = measure.words.slice(Math.max(0, from), Math.max(0, to) + 1);
    count += slice.length;
    preview.push(...slice);
  }

  await updateSettings(chatId, {
    deleteFlow: { ...flow, stage: "confirm" },
    numberButtons: undefined,
  });
  await sendMessage(
    chatId,
    [
      "❓ O'chirishni tasdiqlaysizmi?",
      "",
      `${pointText(flow.start)}dan ${pointText(flow.end)}gacha o'chiriladi.`,
      `Jami ${count} ta so'z.`,
      preview.length > 0 ? `\nO'chiriladigan so'zlar: «${preview.slice(0, 24).join(" ")}${preview.length > 24 ? " …" : ""}»` : "",
      "",
      `Tasdiqlasangiz ${L.deleteConfirm} tugmasini bosing.`,
    ]
      .filter((row) => row.length > 0)
      .join("\n"),
    deleteKeyboard(chatId),
  );
}

/** Tanlangan oraliqdagi so'zlarni o'chiradi va o'zgargan betlarni yuboradi. */
async function performDelete(chatId: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.start || !flow.end || !notebook || notebook.chatId !== chatId) {
    await updateSettings(chatId, { deleteFlow: undefined });
    await sendMessage(chatId, "O'chirish bekor qilindi.", mainKeyboard());
    return;
  }

  const changes: { index: number; text: string }[] = [];
  let removed = 0;
  for (let side = flow.start.side; side <= flow.end.side; side += 1) {
    const text = notebook.sides[side]?.text ?? "";
    if (text.trim().length === 0) continue;
    const measure = await measureSide(chatId, side, text);
    const from = side === flow.start.side ? (measure.lines[flow.start.line - 1]?.wordStart ?? 0) + flow.start.word - 1 : 0;
    const to =
      side === flow.end.side
        ? (measure.lines[flow.end.line - 1]?.wordStart ?? 0) + flow.end.word - 1
        : measure.words.length - 1;
    const clampedFrom = Math.max(0, Math.min(from, measure.words.length - 1));
    const clampedTo = Math.max(clampedFrom, Math.min(to, measure.words.length - 1));
    const result = deleteWordRange(text, clampedFrom, clampedTo);
    removed += clampedTo - clampedFrom + 1;
    changes.push({ index: side, text: result.text });
  }

  if (changes.length === 0) {
    await updateSettings(chatId, { deleteFlow: undefined });
    await sendMessage(chatId, "O'chirish uchun so'z topilmadi.", cardKeyboard());
    return;
  }

  await store.applySides(notebook.id, changes, "o'chirish");
  const updated = store.get(notebook.id) as Notebook;
  await updateSettings(chatId, { deleteFlow: undefined, menu: "books", cardId: notebook.id });
  await sendMessage(
    chatId,
    [
      `🗑 O'chirildi: ${removed} ta so'z.`,
      `${pointText(flow.start)} — ${pointText(flow.end)}`,
      "",
      `Xato bo'lsa ${L.editUndo} tugmasi bilan qaytarishingiz mumkin.`,
      "Tahrirlangan betlar quyida:",
    ].join("\n"),
    reply([[L.editUndo], [L.backBooks]]),
  );
  for (const change of changes) await sendSide(chatId, updated, change.index);
}

/** Oxirgi tahrir amalini orqaga qaytaradi (yozuv yoki o'chirish). */
async function undoLastEdit(chatId: number, notebookId: string): Promise<void> {
  const store = await books();
  const notebook = store.get(notebookId);
  if (!notebook || notebook.chatId !== chatId) {
    await sendMessage(chatId, "Daftar topilmadi — 📚 Daftarlar bo'limidan qayta urinib ko'ring.", mainKeyboard());
    return;
  }

  const edit = await store.undo(notebookId);
  if (!edit) {
    await sendMessage(chatId, "Orqaga qaytarish uchun tahrir amali yo'q.", cardKeyboard());
    return;
  }

  const updated = store.get(notebookId) as Notebook;
  await sendMessage(
    chatId,
    [
      `↩️ «${edit.label}» amali orqaga qaytarildi — daftar avvalgi holatiga keldi.`,
      "",
      "Betlar qayta chizildi:",
    ].join("\n"),
    reply([[L.backBooks]]),
  );
  for (const entry of edit.before) await sendSide(chatId, updated, entry.index);
}

/** Daftar tahrirlash menyusi. */
async function openEditMenu(chatId: number, notebook: Notebook): Promise<void> {
  const store = await books();
  const last = store.lastEdit(notebook.id);
  await updateSettings(chatId, { menu: "edit", cardId: notebook.id });
  await sendMessage(
    chatId,
    [
      `🛠 «${notebook.title}» — tahrirlash`,
      "",
      `${L.editDelete} — betdagi qator va so'zlar bo'yicha oraliqni o'chiradi.`,
      `${L.editUndo} — oxirgi yozuv yoki o'chirishni bekor qiladi.`,
      `${L.cardRename} — daftar nomini almashtiradi.`,
      "",
      last ? `Oxirgi amal: «${last.label}».` : "Hozircha tahrir amali bajarilmagan.",
    ].join("\n"),
    reply([[L.editDelete], [L.editUndo], [L.cardRename], [L.backBooks]]),
  );
}

/* ------------------------------------------------------------------ */
/* Yozish/o'chirish oqimining tugmalarini bajarish                     */
/* ------------------------------------------------------------------ */

/** O'chirish oqimini bekor qiladi. */
async function cancelDeleteFlow(chatId: number): Promise<void> {
  await updateSettings(chatId, { deleteFlow: undefined, numberButtons: undefined, sideButtons: undefined });
  await sendMessage(chatId, "❌ O'chirish bekor qilindi.", cardKeyboard());
}

/** O'chirish oqimida bet tanlandi (avval boshlanish, keyin tugash beti). */
async function pickDeleteSide(chatId: number, side: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow || !notebook) {
    await cancelDeleteFlow(chatId);
    return;
  }

  const measure = await measureSide(chatId, side, notebook.sides[side]?.text ?? "");
  if (measure.lines.length === 0) {
    await sendMessage(chatId, `${side + 1}-betda yozuv yo'q — boshqa betni tanlang.`, deleteKeyboard(chatId));
    return;
  }

  if (flow.stage === "side") {
    // O'chirish shu betdan boshlanadi; qatorni tanlashga o'tamiz.
    await updateSettings(chatId, {
      deleteFlow: { ...flow, start: { side, line: 1, word: 1 }, stage: "startLine" },
      numberButtons: undefined,
    });
    await askDeleteLine(chatId, side, 1);
    return;
  }

  if (flow.stage === "endSide") {
    const start = flow.start;
    if (!start || side < start.side) {
      await sendMessage(
        chatId,
        "Tugash joyi boshlanishidan oldin bo'lishi mumkin emas — qaytadan tanlang.",
        deleteKeyboard(chatId),
      );
      return;
    }
    await updateSettings(chatId, {
      deleteFlow: { ...flow, end: { side, line: start.side === side ? start.line : 1, word: 1 }, stage: "endLine" },
      numberButtons: undefined,
    });
    await askDeleteLine(chatId, side, start.side === side ? start.line : 1);
    return;
  }
}

/** O'chirish oqimida boshlanish qatori tanlandi. */
async function pickDeleteStartLine(chatId: number, line: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.start || !notebook) return;
  const measure = await measureSide(chatId, flow.start.side, notebook.sides[flow.start.side]?.text ?? "");
  if (!measure.lines[line - 1]) {
    await askDeleteLine(chatId, flow.start.side, line);
    return;
  }
  await updateSettings(chatId, {
    deleteFlow: { ...flow, start: { ...flow.start, line, word: 1 }, stage: "startWord" },
  });
  await askDeleteWord(chatId, flow.start.side, line, 1);
}

/** O'chirish oqimida boshlanish so'zi tanlandi: endi tugash joyi so'raladi. */
async function pickDeleteStartWord(chatId: number, word: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.start || !notebook) return;
  const measure = await measureSide(chatId, flow.start.side, notebook.sides[flow.start.side]?.text ?? "");
  const line = measure.lines[flow.start.line - 1];
  if (!line || !line.words[word - 1]) {
    await askDeleteWord(chatId, flow.start.side, flow.start.line, 1);
    return;
  }

  await updateSettings(chatId, {
    deleteFlow: { ...flow, start: { ...flow.start, word }, stage: "endSide" },
  });
  await sendSideSlides(
    chatId,
    notebook,
    [
      "🔚 Saqlandi!",
      "",
      `Boshlanish: ${pointText({ ...flow.start, word })}.`,
      "Endi qayergacha o'chirishni tanlang — betlar yana ko'rsatildi.",
    ].join("\n"),
  );
}

/** O'chirish oqimida tugash qatori tanlandi. */
async function pickDeleteEndLine(chatId: number, line: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.end || !notebook || !flow.start) return;
  const side = flow.end.side;
  const measure = await measureSide(chatId, side, notebook.sides[side]?.text ?? "");
  if (!measure.lines[line - 1] || (side === flow.start.side && line < flow.start.line)) {
    await askDeleteLine(chatId, side, side === flow.start.side ? flow.start.line : 1);
    return;
  }
  const fromWord = side === flow.start.side && line === flow.start.line ? flow.start.word : 1;
  await updateSettings(chatId, {
    deleteFlow: { ...flow, end: { ...flow.end, line, word: fromWord }, stage: "endWord" },
  });
  await askDeleteWord(chatId, side, line, fromWord);
}

/** O'chirish oqimida tugash so'zi tanlandi: tasdiqlashga o'tamiz. */
async function pickDeleteEndWord(chatId: number, word: number): Promise<void> {
  const store = await books();
  const flow = rawSettings(chatId).deleteFlow;
  const notebook = flow ? store.get(flow.notebookId) : undefined;
  if (!flow?.end || !flow.start || !notebook) return;
  const measure = await measureSide(chatId, flow.end.side, notebook.sides[flow.end.side]?.text ?? "");
  const line = measure.lines[flow.end.line - 1];
  if (!line || !line.words[word - 1]) {
    await askDeleteWord(chatId, flow.end.side, flow.end.line, flow.end.word);
    return;
  }
  await updateSettings(chatId, { deleteFlow: { ...flow, end: { ...flow.end, word } } });
  await askDeleteConfirm(chatId);
}

/**
 * Yozish joyi va tahrirlash tugmalarini bajaradi.
 * `true` qaytsa — tugma shu oqimga tegishli edi (boshqa menyu ochilmaydi).
 */
async function handleEditFlowLabel(chatId: number, label: string): Promise<boolean> {
  const settings = rawSettings(chatId);
  const un = unmark(label);
  const store = await books();
  const card = settings.cardId ? store.get(settings.cardId) : undefined;
  const cardOk = card && card.chatId === chatId ? card : undefined;

  // Tahrirlash menyusi (karta ochiq bo'lmasa — ochiq daftar bo'yicha).
  const editTarget = cardOk ?? (settings.notebookId ? store.get(settings.notebookId) : undefined);
  if (un === L.cardEdit) {
    if (editTarget) {
      await openEditMenu(chatId, editTarget);
      return true;
    }
    await openMenu(chatId, "books");
    return true;
  }
  if (un === L.editDelete) {
    const notebook = cardOk ?? (settings.notebookId ? store.get(settings.notebookId) : undefined);
    if (notebook) {
      await startDeleteFlow(chatId, notebook);
      return true;
    }
  }
  if (un === L.editUndo || un === L.writeUndo) {
    if (editTarget) {
      await undoLastEdit(chatId, editTarget.id);
      return true;
    }
    await sendMessage(chatId, "Avval daftar tanlang — 📚 Daftarlar bo'limidan daftar kartasini oching.", mainKeyboard());
    return true;
  }

  // Yozish oqimi tugmalari.
  if (settings.writeFlow) {
    const flow = settings.writeFlow;
    const notebook = store.get(flow.notebookId);
    if (!notebook || notebook.chatId !== chatId) {
      await updateSettings(chatId, { writeFlow: undefined });
      await sendMessage(chatId, "Daftar topilmadi — 📚 Daftarlar bo'limidan qayta tanlang.", mainKeyboard());
      return true;
    }

    if (un === L.deleteCancel) {
      // Joy tanlashni tashlab, daftar kartasiga qaytamiz (matn yozib yuborilmaydi).
      await updateSettings(chatId, { writeFlow: undefined, lineButtons: undefined });
      await sendMessage(chatId, "❌ Joy tanlash bekor qilindi — daftar kartasi ochiq.", cardKeyboard());
      return true;
    }

    if (un === L.writePickLine) {
      await askWriteLine(chatId);
      return true;
    }

    if (un === L.writeNewSide) {
      const sideIndex = store.usedSides(notebook);
      if (sideIndex >= store.capacity(notebook)) {
        await updateSettings(chatId, { writeFlow: undefined, menu: "newbook" });
        await sendMessage(chatId, "📕 Bu daftar to'ldi — ➕ Yangi daftar yaratishingiz mumkin.", newBookKeyboard());
        return true;
      }
      await updateSettings(chatId, { writeFlow: { ...flow, sideIndex, line: 1 } });
      await askSkipLines(chatId);
      return true;
    }

    if (un === L.writeContinue) {
      await askSkipLines(chatId);
      return true;
    }

    if (flow.stage === "line" && /^\d+$/.test(un)) {
      const line = Number.parseInt(un, 10);
      const measure = await measureSide(chatId, flow.sideIndex, notebook.sides[flow.sideIndex]?.text ?? "");
      if (line < 1 || line > measure.linesPerPage) {
        await askWriteLine(chatId);
        return true;
      }
      await updateSettings(chatId, { writeFlow: { ...flow, line, stage: "skip" } });
      await askSkipLines(chatId);
      return true;
    }

    if (flow.stage === "skip") {
      // «⬇️ Yozuvning tagidan» — 0 qator tashlanadi: yangi yozuv oxirgi
      // yozilgan qatorning tagidan boshlanadi.
      if (un === L.writeUnder) {
        await finishWritePosition(chatId);
        return true;
      }
      const skipMatch = /^(?:⏭\s*)?(\d+)$/.exec(un);
      if (skipMatch) {
        const skip = Number.parseInt(skipMatch[1], 10);
        await updateSettings(chatId, { writeFlow: { ...flow, line: (flow.line ?? 1) + skip } });
        await finishWritePosition(chatId);
        return true;
      }
    }
  }

  // O'chirish oqimi tugmalari.
  if (settings.deleteFlow) {
    const flow = settings.deleteFlow;
    if (un === L.deleteCancel) {
      await cancelDeleteFlow(chatId);
      return true;
    }
    if (un === L.deleteConfirm) {
      await performDelete(chatId);
      return true;
    }

    const sideIndex = settings.sideButtons?.[label] ?? settings.sideButtons?.[un];
    if (sideIndex !== undefined && (flow.stage === "side" || flow.stage === "endSide")) {
      await pickDeleteSide(chatId, sideIndex);
      return true;
    }

    if (/^\d+$/.test(un)) {
      const value = Number.parseInt(un, 10);
      if (flow.stage === "startLine") {
        await pickDeleteStartLine(chatId, value);
        return true;
      }
      if (flow.stage === "startWord") {
        await pickDeleteStartWord(chatId, value);
        return true;
      }
      if (flow.stage === "endLine") {
        await pickDeleteEndLine(chatId, value);
        return true;
      }
      if (flow.stage === "endWord") {
        await pickDeleteEndWord(chatId, value);
        return true;
      }
    }
  }

  return false;
}

/* ------------------------------------------------------------------ */
/* Uslubimni nusxalash: namuna olish oqimi                            */
/* ------------------------------------------------------------------ */

/** Telegram'dagi eng katta rasm o'lchamining file_id'si. */
function largestPhotoId(message: TgMessage): string | undefined {
  const photos = message.photo ?? [];
  return photos[photos.length - 1]?.file_id;
}

/** Telegram serveridagi faylni yuklab oladi (rasm namunalari uchun). */
async function downloadTelegramFile(fileId: string): Promise<Uint8Array> {
  const file = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = file?.file_path;
  if (!path) throw new Error("Telegram fayl yo'lini qaytarmadi.");

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const root = process.env.TELEGRAM_API_BASE?.trim().replace(/\/+$/, "") || "https://api.telegram.org";
  const response = await fetch(`${root}/file/bot${token}/${path}`);
  if (!response.ok) throw new Error(`fayl yuklanmadi (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Namuna olishni boshlaydi: 1-qadam (so'zlar) ko'rsatmasi yuboriladi. */
async function startStyleSample(chatId: number): Promise<void> {
  const store = await styles();
  const saved = store.list(chatId);
  if (saved.length >= MAX_STYLES_PER_CHAT) {
    await sendMessage(
      chatId,
      [
        `Sizda allaqachon ${saved.length} ta uslub bor (ko'pi bilan ${MAX_STYLES_PER_CHAT} ta).`,
        "",
        `Yangi namuna olish uchun keraksiz uslubni ${L.styleDelete} tugmasi bilan o'chiring.`,
      ].join("\n"),
      styleKeyboard(chatId),
    );
    return;
  }

  await updateSettings(chatId, {
    menu: "style",
    styleStep: "words",
    styleWords: undefined,
    styleDraft: undefined,
    pending: undefined,
  });
  await sendMessage(chatId, styleWordsText(), styleKeyboard(chatId));
}

/**
 * Namunani o'lchab, eng yaqin shriftni tanlaydi va uslubga nom so'raydi.
 *
 * Bu yerda har bir nomzod shrift bilan namuna matni chizilib, xuddi
 * foydalanuvchi surati kabi o'lchanadi (`calibrateStyle`) — shuning uchun
 * jarayon bir necha soniya davom etadi va holat xabari yangilanib turadi.
 */
async function measureStyleSample(
  chatId: number,
  words: SampleProfile,
  digits: SampleProfile | null,
): Promise<void> {
  const profile = mergeProfiles(words, digits);
  const fontIds = FONT_LIBRARY.map((entry) => entry.id);
  const fonts = await loadFonts([...fontIds, FALLBACK_FONT_ID]);
  const available = fontIds.filter((id) => Boolean(fonts[id]));
  if (available.length === 0) {
    await sendMessage(chatId, "Kechirasiz, shrift fayllari topilmadi — botni qayta ishga tushirish kerak. 🙏");
    return;
  }

  const statusId = await sendMessage(chatId, "🧠 Yozuvingiz o'lchanmoqda...");
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

  const calibration = await calibrateStyle({
    profile,
    fonts,
    candidateIds: available,
    onProgress: async (done, total) => {
      if (statusId && (done % 6 === 0 || done === total)) {
        await editMessage(chatId, statusId, `🧠 Yozuvingiz o'lchanmoqda... ${done}/${total} shrift tekshirildi`);
      }
    },
  });

  const draft: StyleDraft = {
    baseFont: calibration.baseFont,
    personal: calibration.personal,
    summary: personalSummary(calibration.personal),
  };
  await updateSettings(chatId, {
    menu: "style",
    styleStep: undefined,
    styleWords: undefined,
    styleDraft: draft,
    pending: { kind: "styleName" },
  });

  await sendMessage(
    chatId,
    [
      "✅ Namunangiz o'lchandi!",
      "",
      `• Eng yaqin qo'lyozma: ${displayName(calibration.baseFont)}`,
      `• Sizning xususiyatlaringiz: ${draft.summary || "o'rtacha yozuv"}`,
      `• O'lchangan satrlar: ${profile.lines}`,
      digits ? "• Raqamlar namunasi ham hisobga olindi" : "• Raqamlar namunasisiz (so'zlar asosida)",
      "",
      "✏️ Endi uslubga nom bering — keyingi xabaringiz nom bo'ladi (masalan «Mening yozuvim»).",
      `Nom kerak bo'lmasa ${L.skipName} tugmasini bosing.`,
    ].join("\n"),
    reply([[L.skipName], [L.styleCancel]]),
  );
}

/** Nom berilgach (yoki nomsiz) uslubni bazaga saqlaydi va yoqadi. */
async function saveStyle(chatId: number, name?: string): Promise<void> {
  const draft = rawSettings(chatId).styleDraft;
  if (!draft) {
    await openMenu(chatId, "style");
    return;
  }

  const store = await styles();
  const list = store.list(chatId);
  const wanted = (name ? cleanStyleName(name) : null) ?? defaultStyleName(list);
  const record = await store.create({
    chatId,
    name: uniqueStyleName(list, wanted),
    baseFont: draft.baseFont,
    personal: draft.personal,
    summary: draft.summary,
  });

  await updateSettings(chatId, {
    styleDraft: undefined,
    styleWords: undefined,
    styleStep: undefined,
    pending: undefined,
    styleId: record.id,
    menu: "style",
  });

  await sendMessage(
    chatId,
    [
      `✅ «${record.name}» uslubi saqlandi va yoqildi.`,
      `• Asos: ${displayName(record.baseFont)}`,
      record.summary ? `• ${record.summary}` : "",
      "",
      "Endi yuborgan matningiz shu uslubda — ya'ni sizning qo'lyozmangizga moslab chiziladi.",
      "Uslub faqat sizga ko'rinadi: boshqa foydalanuvchilar uni ko'rmaydi.",
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
    styleKeyboard(chatId),
  );
}

/**
 * Namunaviy rasmni qabul qiladi: yuklab oladi, o'lchaydi va keyingi qadamga
 * o'tadi.
 *
 * Namuna kutilmayotgan bo'lsa rasm **jimgina** qabul qilinadi: foydalanuvchi
 * so'ramagan yo'l-yo'riq yuborilmaydi (uslub bo'limi menyuda allaqachon
 * turadi).
 */
async function handleStyleSample(chatId: number, fileId: string): Promise<void> {
  const step = rawSettings(chatId).styleStep;
  // Faqat namuna qadamlari rasm qabul qiladi; boshqa paytda kelgan suratga
  // javob berilmaydi — ortiqcha xabar yubormaslik uchun.
  if (step !== "words" && step !== "digits") return;

  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

  let profile: SampleProfile;
  try {
    profile = analyzeSample(decodeSampleImage(await downloadTelegramFile(fileId)));
  } catch (error) {
    await sendMessage(
      chatId,
      [
        `⚠️ Rasmni o'qib bo'lmadi: ${(error as Error).message}`,
        "",
        "Varaqni yorug' joyda, to'liq ko'rinadigan qilib qayta suratga olib yuboring.",
      ].join("\n"),
      styleKeyboard(chatId),
    );
    return;
  }

  // Katak varaqadagi 10 ta raqamda siyoh kam bo'ladi, shuning uchun chegara
  // qadamga qarab pasaytiriladi (chiziqlar allaqachon olib tashlangan).
  const quality = sampleQuality(profile, {
    minLines: 1,
    minInk: step === "words" ? 400 : 150,
  });
  if (!quality.ok) {
    await sendMessage(
      chatId,
      [
        `⚠️ ${quality.reason}`,
        "",
        step === "words"
          ? "10 ta so'zni yozib, varaqni to'liq ko'rinishda qayta suratga oling."
          : "10 ta raqamni bir satrga yozib, varaqni to'liq ko'rinishda qayta suratga oling.",
      ].join("\n"),
      styleKeyboard(chatId),
    );
    return;
  }

  if (step === "words") {
    await updateSettings(chatId, { styleWords: profile, styleStep: "digits" });
    await sendMessage(chatId, styleDigitsText(), styleKeyboard(chatId));
    return;
  }

  const words = rawSettings(chatId).styleWords;
  if (!words) {
    // So'zlar namunasi yo'q (masalan, bot qayta ishga tushgan) — 1-qadamdan boshlaymiz.
    await updateSettings(chatId, { styleStep: "words" });
    await sendMessage(chatId, ["So'zlar namunasi topilmadi — 1-qadamdan boshlaymiz.", "", styleWordsText()].join("\n"), styleKeyboard(chatId));
    return;
  }

  await measureStyleSample(chatId, words, profile);
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

  // 0. Yordam va chat ID: buyruqlar ro'yxati o'rniga tugmalar.
  if (label === L.help) {
    await updateSettings(chatId, { menu: "main" });
    await sendMessage(chatId, helpText(), mainKeyboard());
    return true;
  }
  if (label === L.chatId) {
    await sendMessage(chatId, `🆔 Chat ID: ${chatId}`, mainKeyboard());
    return true;
  }

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

  // 1a. Yozish joyi va tahrirlash oqimlarining tugmalari (raqamlar, betlar).
  if (await handleEditFlowLabel(chatId, label)) return true;

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
      store.setActive(chatId, notebook.id);
      await openWriteSession(chatId, notebook, store);
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

  // 1c. Nomsiz qoldirish (daftarga yoki uslubga nom so'ralganda).
  if (label === L.skipName) {
    const pending = rawSettings(chatId).pending;
    if (pending?.kind === "create") {
      await updateSettings(chatId, { pending: undefined });
      await createNotebook(chatId, pending.sheets, pending.paper ?? DEFAULT_STYLE.paper);
    } else if (pending?.kind === "styleName") {
      await updateSettings(chatId, { pending: undefined });
      await saveStyle(chatId);
    } else {
      await openMenu(chatId, "books");
    }
    return true;
  }

  // 1d. «Uslubimni nusxalash» bo'limi.
  if (label === L.styleCopy) {
    await updateSettings(chatId, { menu: "style" });
    await sendMessage(chatId, styleText(chatId), styleKeyboard(chatId));
    return true;
  }

  if (label === L.styleStart) {
    await startStyleSample(chatId);
    return true;
  }

  if (label === L.styleSkipDigits) {
    const words = rawSettings(chatId).styleWords;
    if (words) await measureStyleSample(chatId, words, null);
    else await openMenu(chatId, "style");
    return true;
  }

  if (label === L.styleCancel) {
    const wasDeleting = rawSettings(chatId).styleStep === "delete";
    await updateSettings(chatId, {
      menu: "style",
      styleStep: undefined,
      styleWords: undefined,
      styleDraft: undefined,
      pending: undefined,
    });
    await sendMessage(
      chatId,
      wasDeleting ? "❌ O'chirish bekor qilindi — uslublar o'z holida qoldi." : "❌ Namuna bekor qilindi.",
      styleKeyboard(chatId),
    );
    return true;
  }

  if (label === L.styleStop) {
    await updateSettings(chatId, { styleId: undefined });
    await sendMessage(
      chatId,
      "⏹ Shaxsiy uslub to'xtatildi — endi ommaviy shriftlar ishlatiladi. Uslub bazada qoladi.",
      styleKeyboard(chatId),
    );
    return true;
  }

  if (label === L.styleDelete) {
    const store = await styles();
    const list = store.list(chatId);
    if (list.length === 0) {
      await openMenu(chatId, "style");
      return true;
    }
    // Bir nechta uslub bo'lsa — qaysi birini o'chirishni so'raymiz (shunda
    // keraksizni o'chirish uchun uni avval yoqish shart emas).
    if (list.length > 1) {
      await updateSettings(chatId, { menu: "style", styleStep: "delete" });
      await sendMessage(chatId, deletePickerText(list), styleKeyboard(chatId));
      return true;
    }

    const only = list[0];
    await store.remove(chatId, only.id);
    const active = activeStyle(chatId);
    await updateSettings(chatId, {
      menu: "style",
      styleStep: undefined,
      ...(active?.id === only.id ? { styleId: undefined } : {}),
    });
    await sendMessage(chatId, styleDeletedText(only.name, 0), styleKeyboard(chatId));
    return true;
  }

  // 1d-0. O'chirish tanlovi: `🗑 <nom>` tugmasi bosildi.
  if (unmark(label).startsWith("🗑 ")) {
    const wanted = unmark(label).slice(2).trim();
    const store = await styles();
    const record = store.list(chatId).find((item) => item.name === wanted);
    if (record && (await store.remove(chatId, record.id))) {
      const active = activeStyle(chatId);
      await updateSettings(chatId, {
        menu: "style",
        styleStep: undefined,
        ...(active?.id === record.id ? { styleId: undefined } : {}),
      });
      await sendMessage(chatId, styleDeletedText(record.name, store.list(chatId).length), styleKeyboard(chatId));
      return true;
    }
    await openMenu(chatId, "style");
    return true;
  }

  // 1e. Saqlangan uslubni yoqish (`✒️ nom` tugmasi → tugma matni xaritasi).
  if (/^(✓\s*)?✒️ /.test(label)) {
    const store = await styles();
    const list = store.list(chatId);
    const mapped = rawSettings(chatId).styleButtons?.[label] ?? rawSettings(chatId).styleButtons?.[unmark(label)];
    const record = mapped
      ? store.get(chatId, mapped)
      : list.find((item) => unmark(label) === `✒️ ${item.name}`);
    if (record) {
      await updateSettings(chatId, { styleId: record.id, menu: "style", pending: undefined, styleStep: undefined });
      await sendMessage(
        chatId,
        [
          `✅ «${record.name}» uslubi yoqildi.`,
          `• Asos: ${displayName(record.baseFont)}`,
          record.summary ? `• ${record.summary}` : "",
          "",
          "Endi barcha varaqalar shu uslubda chiziladi.",
        ]
          .filter((line) => line.length > 0)
          .join("\n"),
        styleKeyboard(chatId),
      );
      return true;
    }
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

  // 3. Varaq soni tanlash (yangi daftar) — keyin qog'oz turi so'raladi.
  const sheetChoice = SHEET_BUTTONS.find((option) => option.text === unmark(label));
  if (sheetChoice) {
    await askBookPaper(chatId, sheetChoice.sheets);
    return true;
  }

  // 3b. Qog'oz turi tanlash (yangi daftar) — keyin nom so'raladi.
  const paperChoice = NEWBOOK_PAPERS.find((option) => option.text === unmark(label));
  const pendingCreate = rawSettings(chatId).pending;
  if (paperChoice && pendingCreate?.kind === "create") {
    await askBookName(chatId, pendingCreate.sheets, paperChoice.paper);
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
      // Daftar tanlangach darhol "qayerdan yozamiz?" so'raladi: oxirgi yozuv
      // joyi va betdagi bo'sh qatorlar ko'rsatiladi.
      store.setActive(chatId, notebook.id);
      await openWriteSession(chatId, notebook, store);
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
    // Qog'oz turi tanlanmagan bo'lsa (eski holat) — standart qog'oz olinadi.
    await createNotebook(chatId, pending.sheets, pending.paper ?? DEFAULT_STYLE.paper, text);
    return true;
  }

  if (pending.kind === "styleName") {
    await saveStyle(chatId, text);
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

  if (command === "/start") {
    await updateSettings(chatId, { menu: "main" });
    await sendMessage(chatId, welcomeText(), mainKeyboard());
    return;
  }

  if (command === "/help") {
    await updateSettings(chatId, { menu: "main" });
    await sendMessage(chatId, helpText(), mainKeyboard());
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

  if (command === "/studio" || command === "/app") {
    await sendMessage(chatId, studioText(), studioMarkup() ?? mainKeyboard());
    return;
  }

  if (command === "/fonts") {
    await openFontPage(chatId, fontPageOf(chatId));
    return;
  }

  if (command === "/style" || command === "/uslub") {
    await updateSettings(chatId, { menu: "style" });
    await sendMessage(chatId, styleText(chatId), styleKeyboard(chatId));
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

  // Noma'lum buyruq: qisqa javob. Avval har bir buyruqning ro'yxatini tashlab
  // yuborardik — foydalanuvchi ekrani to'lib ketardi; endi faqat tugmalarni
  // taklif qilamiz (to'liq qo'llanma — ℹ️ Yordam tugmasida).
  if (command.startsWith("/") && args.length === 0 && command.length <= 12) {
    await sendMessage(
      chatId,
      [
        `❓ «${command}» — bunday buyruq yo'q.`,
        "",
        `Pastdagi tugmalardan foydalaning: ${L.text} yoki ${L.settings}.`,
        `Qo'llanma kerak bo'lsa — ${L.help}.`,
      ].join("\n"),
      mainKeyboard(),
    );
    return;
  }

  await writeToNotebook(chatId, text);
}

/* ------------------------------------------------------------------ */
/* Update'larni qayta ishlash                                          */
/* ------------------------------------------------------------------ */

async function processUpdate(update: TgUpdate): Promise<void> {
  const message = update.message;
  if (!message?.chat) return;

  const chatId = message.chat.id;

  // Rasm (namuna): foto yoki hujjat sifatida yuborilgan bo'lishi mumkin.
  const photoId = largestPhotoId(message);
  if (photoId) {
    await handleStyleSample(chatId, photoId);
    return;
  }
  const document = message.document;
  if (document && (document.mime_type ?? "").startsWith("image/")) {
    await handleStyleSample(chatId, document.file_id);
    return;
  }

  if (typeof message.text !== "string") return;
  const text = message.text.trim();

  if (text.startsWith("/")) {
    await handleCommand(chatId, text);
    return;
  }

  if (await handleMenuLabel(chatId, text)) return;
  if (await handlePendingText(chatId, text)) return;

  // Faqat havoladan iborat xabar daftarga yozilmaydi: varaqada manzil foydasiz,
  // shuning uchun javob ham qaytarmaymiz (so'ralmagan xabar chiqmasin).
  if (isBareLink(text)) return;

  await writeToNotebook(chatId, text);
}

/** Xabar faqat havola(lar)dan iboratmi — ya'ni daftarga yozadigan matn yo'qmi. */
function isBareLink(text: string): boolean {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  return parts.every((part) => /^(https?:\/\/|www\.|t\.me\/)\S+$/i.test(part));
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

/**
 * Botning kichik HTTP serveri.
 *
 * Yo'llar:
 *   POST /telegram/webhook — faqat webhook rejimida (Telegram update'lari);
 *   POST /mini-app/send    — Studio (Mini App) natijasini chatga yuborish;
 *   POST /mini-app/state   — Studio uchun daftarlar va joriy bet holati;
 *   POST /mini-app/notebook— daftar yaratish/nomlash/o'chirish/undo/kitob;
 *   GET  /healthz          — server tirikligini tekshirish.
 *
 * Mini App uchun webhook shart emas: `MINI_APP_URL` o'rnatilgan bo'lsa, server
 * long polling rejimida ham ishga tushadi (nginx `/mini-app/` ni shu portga
 * proxy qiladi).
 */
async function startHttpServer(options: { webhookBaseUrl?: string } = {}): Promise<void> {
  const port = Number(process.env.PORT ?? 8080);
  const secret = process.env.BOT_SECRET?.trim();
  const baseUrl = options.webhookBaseUrl;
  const appUrl = miniAppUrl();

  const allowedOrigins = [
    ...MINI_APP_EXTRA_ORIGINS,
    ...(appUrl ? [originFromUrl(appUrl)].filter((origin): origin is string => Boolean(origin)) : []),
  ];
  const handleMiniApp = createMiniAppHandler({
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    allowedOrigins,
    send: sendMiniAppText,
    state: miniAppState,
    notebook: miniAppNotebook,
  });

  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];

    if (request.method === "GET" && path === HEALTH_PATH) {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ok");
      return;
    }

    if (path === MINI_APP_PATH || path === MINI_APP_STATE_PATH || path === MINI_APP_NOTEBOOK_PATH) {
      void handleMiniApp(request, response);
      return;
    }

    if (!baseUrl || request.method !== "POST" || !path.startsWith(WEBHOOK_PATH)) {
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
  const routes = [
    HEALTH_PATH,
    ...(appUrl ? [MINI_APP_PATH, MINI_APP_STATE_PATH, MINI_APP_NOTEBOOK_PATH] : []),
    ...(baseUrl ? [WEBHOOK_PATH] : []),
  ];
  console.log(`🌐 HTTP server 0.0.0.0:${port} da tinglayapti (${routes.join(", ")}).`);

  if (baseUrl) {
    const url = `${baseUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
    await tg("setWebhook", {
      url,
      allowed_updates: ALLOWED_UPDATES,
      ...(secret ? { secret_token: secret } : {}),
    });
    console.log(`✅ Webhook ro'yxatga olindi: ${url}`);
  }
  if (appUrl) console.log(`🖥 Mini App manzili: ${appUrl}`);
}

/**
 * Chat menyusidagi tugmani (matn maydoni yonidagi) Studio Mini App'ga bog'laydi.
 *
 * `MINI_APP_URL` bo'lmasa hech narsa qilmaymiz — foydalanuvchi qo'lda qo'ygan
 * menyu tugmasi o'chirilib qolmasligi uchun.
 */
async function configureMenuButton(): Promise<void> {
  const url = miniAppUrl();
  if (!url) return;
  try {
    await tg("setChatMenuButton", {
      menu_button: { type: "web_app", text: "Studio", web_app: { url } },
    });
    console.log("🖥 Chat menyusidagi tugma Studio Mini App'ga bog'landi.");
  } catch (error) {
    console.warn("setChatMenuButton bajarilmadi:", (error as Error).message);
  }
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
  console.log("🖥 Mini App (Studio):");
  console.log(`   manzil    : ${miniAppUrl() ?? "(yo'q — MINI_APP_URL o'rnatilmagan)"}`);
  console.log(
    miniAppUrl()
      ? `   endpoint  : POST ${MINI_APP_PATH} • GET ${HEALTH_PATH} (0.0.0.0:${Number(process.env.PORT ?? 8080)})`
      : "   holat     : Mini App tugmalari qo'shilmagan (polling/webhook baribir ishlaydi)",
  );
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

  // Uslublar bazasini oldindan yuklaymiz: `styleFor()` sinxron ishlaydi, shu
  // sababli faol uslub har doim xotiradan olinadi.
  await styles();

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
    await configureMenuButton();
    await startHttpServer({ webhookBaseUrl: baseUrl });
    return;
  }

  // Long polling: Studio (Mini App) sozlangan bo'lsa, HTTP endpoint ham kerak.
  await configureMenuButton();
  if (miniAppUrl()) await startHttpServer();
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
