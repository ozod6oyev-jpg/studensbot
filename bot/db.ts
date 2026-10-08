/**
 * Bazalar: daftarlar (`notebooks.json`) va shaxsiy yozuv uslublari
 * (`styles.json`).
 *
 * Daftar bazasi — har bir chat uchun "daftar" (notebook) yozuvlari.
 *
 * Foydalanuvchi yangi daftar yaratadi (12/36/48/96 varaq) va qog'oz turini
 * tanlaydi (yo'l-yo'l / katak / oq varaq), keyin yozgan matni varaq tomonlariga
 * ketma-ket joylashadi. Har bir varaq ikki tomondan iborat: juft indeks — old
 * tomon (chegara chapda), toq indeks — orqa tomon (chegara o'ngda).
 *
 * Qog'oz turi daftarning o'zida (`paper`) saqlanadi: bir chatda yo'l-yo'l va
 * katak daftar birga turishi mumkin, shuning uchun chat sozlamasidagi qog'oz
 * daftar ichida ishlatilmaydi.
 *
 * Ma'lumot `${dataDir}/notebooks.json` faylida saqlanadi. Yozish atomar:
 * avval vaqtinchalik faylga yoziladi, keyin nomi almashtiriladi — shu tufayli
 * jarayon o'rtada to'xtab qolsa ham fayl buzilmaydi.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FontId, PaperType, PersonalStyle } from "../src/lib/handwriting/types";

export type NotebookSheets = 12 | 36 | 48 | 96;

/** Yangi daftar yaratishda taklif qilinadigan varaq sonlari. */
export const SHEET_CHOICES: NotebookSheets[] = [12, 36, 48, 96];

/**
 * Daftarda saqlanadigan qog'oz turlari (yaratishda tanlanadi).
 * Fayldagi eski daftarlarda `paper` bo'lmasa yoki noma'lum bo'lsa — `lined`.
 */
export const PAPER_CHOICES: PaperType[] = ["lined", "grid", "plain"];

export interface NotebookSide {
  text: string;
  createdAt: number;
}

/**
 * Bitta tahrir amali: yozish yoki o'chirishdan OLDINGI holat.
 *
 * "Orqaga qaytarish" shu yozuvlar orqali ishlaydi — matnning o'zi emas, faqat
 * o'zgargan betlarning eski ko'rinishi saqlanadi (shu sababli xotira tejaladi).
 */
export interface NotebookEdit {
  at: number;
  /** Foydalanuvchiga ko'rsatiladigan qisqa izoh ("yozuv", "o'chirish"). */
  label: string;
  /** O'zgargan betlar: indeks → eski matn. */
  before: { index: number; text: string }[];
  /** Amal natijasida qo'shilgan betlar soni (orqaga qaytarishda olib tashlanadi). */
  addedSides: number;
}

export interface Notebook {
  id: string;
  chatId: number;
  /** Daftardagi varaq soni (har bir varaq = 2 tomon). */
  sheets: NotebookSheets;
  /**
   * Daftar qog'ozi: yo'l-yo'l (`lined`), katak (`grid`) yoki oq varaq (`plain`).
   * Yaratishda tanlanadi va shu daftarda saqlanadi.
   */
  paper: PaperType;
  title: string;
  createdAt: number;
  /** index i: juft — old tomon (recto), toq — orqa tomon (verso). */
  sides: NotebookSide[];
  /** Tahrir tarixi (orqaga qaytarish uchun), eng yangisi oxirida. */
  history?: NotebookEdit[];
}

/** Yangi daftar yaratish uchun kirish (`paper` berilmasa — yo'l-yo'l qog'oz). */
export interface NotebookCreateInput {
  chatId: number;
  sheets: NotebookSheets;
  paper?: PaperType;
  title?: string;
}

export interface NotebookStore {
  /** Chatdagi daftarlar (yaratilish tartibida). */
  list(chatId: number): Notebook[];
  get(id: string): Notebook | undefined;
  /** Jami tomonlar soni: `sheets * 2`. */
  capacity(notebook: Notebook): number;
  /** Nechta tomon band qilingan. */
  usedSides(notebook: Notebook): number;
  /** Bo'sh joy bo'lsa yangi tomon qo'shadi, aks holda `null`. */
  addSide(id: string): Promise<NotebookSide | null>;
  /** Mavjud tomonning matnini almashtiradi. */
  setSideText(id: string, sideIndex: number, text: string): Promise<boolean>;
  /**
   * Bir yoki bir nechta betni almashtiradi/qo'shadi va orqaga qaytarish uchun
   * tarixga yozadi. `changes` indekslari ketma-ket: mavjud betlar almashtiriladi,
   * `sides.length` dan boshlab yangi betlar qo'shiladi.
   */
  applySides(id: string, changes: { index: number; text: string }[], label: string): Promise<boolean>;
  /** Oxirgi amalni orqaga qaytaradi (tarix bo'sh bo'lsa `null`). */
  undo(id: string): Promise<NotebookEdit | null>;
  /** Oxirgi amal tavsifi (tugma izohi uchun). */
  lastEdit(id: string): NotebookEdit | undefined;
  create(input: NotebookCreateInput): Promise<Notebook>;
  /** Daftar nomini almashtiradi (bo'sh nom rad etiladi). */
  rename(id: string, title: string): Promise<boolean>;
  /** Ochiq daftar — faqat xotirada saqlanadi (faylga yozilmaydi). */
  setActive(chatId: number, id: string | null): void;
  activeId(chatId: number): string | undefined;
  remove(id: string): Promise<boolean>;
}

interface DbFile {
  version: number;
  notebooks: Notebook[];
}

const DB_VERSION = 1;

/** Nechta tahrir amalini orqaga qaytarish mumkin (har bir daftar uchun). */
export const MAX_EDIT_HISTORY = 10;

export function capacityOf(notebook: Notebook): number {
  return notebook.sheets * 2;
}

export function usedSidesOf(notebook: Notebook): number {
  return notebook.sides.length;
}

/** Daftar nomining eng katta uzunligi (tugma matniga sig'ishi uchun). */
export const TITLE_MAX = 40;

/**
 * Foydalanuvchi yozgan nomni tozalaydi: ortiqcha bo'shliq va boshqaruv
 * belgilari olib tashlanadi, uzunlik cheklanadi. Bo'sh natija `null`.
 */
export function cleanTitle(value: string): string | null {
  // Boshqaruv belgilari va yangi qatorlar PDF hamda tugma matnini buzadi.
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Fayldagi yozuvni tekshirib, to'g'ri shaklga keltiradi (buzilganlar tashlanadi). */
function sanitizeSide(value: unknown): NotebookSide | null {
  if (!value || typeof value !== "object") return null;
  const side = value as Partial<NotebookSide>;
  return {
    text: typeof side.text === "string" ? side.text : "",
    createdAt: typeof side.createdAt === "number" && Number.isFinite(side.createdAt) ? side.createdAt : Date.now(),
  };
}

function sanitizeNotebook(value: unknown): Notebook | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Notebook>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.chatId !== "number" || !Number.isFinite(raw.chatId)) return null;
  if (!SHEET_CHOICES.includes(raw.sheets as NotebookSheets)) return null;

  const sheets = raw.sheets as NotebookSheets;
  const sides = Array.isArray(raw.sides)
    ? raw.sides.map(sanitizeSide).filter((side): side is NotebookSide => side !== null)
    : [];

  return {
    id: raw.id,
    chatId: raw.chatId,
    sheets: raw.sheets as NotebookSheets,
    // Qog'oz turi keyinroq qo'shildi: eski yozuvlarda yo'q — yo'l-yo'l olamiz.
    paper: PAPER_CHOICES.includes(raw.paper as PaperType) ? (raw.paper as PaperType) : "lined",
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "daftar",
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    // Varaq sonidan ortiq tomon bo'lsa (fayl qo'lda tahrirlangan bo'lishi mumkin) — kesamiz.
    sides: sides.slice(0, sheets * 2),
    history: sanitizeHistory(raw.history),
  };
}

/** Tahrir tarixini tekshiradi (buzilgan yozuvlar tashlanadi, oxirgi 10 tasi qoladi). */
function sanitizeHistory(value: unknown): NotebookEdit[] {
  if (!Array.isArray(value)) return [];
  const edits: NotebookEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<NotebookEdit>;
    if (!Array.isArray(raw.before)) continue;
    const before = raw.before
      .filter((entry): entry is { index: number; text: string } =>
        Boolean(entry) && typeof entry.index === "number" && typeof entry.text === "string",
      )
      .map((entry) => ({ index: Math.max(0, Math.floor(entry.index)), text: entry.text }));
    if (before.length === 0) continue;
    edits.push({
      at: typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : Date.now(),
      label: typeof raw.label === "string" ? raw.label.slice(0, 60) : "tahrir",
      before,
      addedSides: typeof raw.addedSides === "number" && Number.isFinite(raw.addedSides) ? Math.max(0, Math.floor(raw.addedSides)) : 0,
    });
  }
  return edits.slice(-MAX_EDIT_HISTORY);
}

export async function createStore(dataDir: string): Promise<NotebookStore> {
  const file = join(dataDir, "notebooks.json");
  const notebooks = new Map<string, Notebook>();
  const active = new Map<number, string>();

  /** Fayldan o'qish: fayl yo'q yoki buzilgan bo'lsa bo'sh ombor. */
  async function load(): Promise<void> {
    try {
      const raw = await readFile(file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as Partial<DbFile>)?.notebooks as unknown[] | undefined) ?? [];
      if (!Array.isArray(list)) {
        console.warn("notebooks.json formati kutilganidek emas — bo'sh baza ishlatiladi");
        return;
      }
      for (const item of list) {
        const notebook = sanitizeNotebook(item);
        if (notebook) notebooks.set(notebook.id, notebook);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        console.warn("notebooks.json o'qilmadi:", (error as Error).message);
      }
    }
  }

  async function save(): Promise<void> {
    try {
      await mkdir(dataDir, { recursive: true });
      const payload: DbFile = { version: DB_VERSION, notebooks: Array.from(notebooks.values()) };
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
      await rename(tmp, file);
    } catch (error) {
      console.warn("notebooks.json saqlanmadi:", (error as Error).message);
    }
  }

  function nextId(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const id = `nb${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
      if (!notebooks.has(id)) return id;
    }
    return `nb${Date.now().toString(36)}${notebooks.size}`;
  }

  await load();

  return {
    list(chatId: number): Notebook[] {
      return Array.from(notebooks.values())
        .filter((notebook) => notebook.chatId === chatId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    get(id: string): Notebook | undefined {
      return notebooks.get(id);
    },

    capacity: capacityOf,
    usedSides: usedSidesOf,

    async addSide(id: string): Promise<NotebookSide | null> {
      const notebook = notebooks.get(id);
      if (!notebook) return null;
      if (usedSidesOf(notebook) >= capacityOf(notebook)) return null;

      const side: NotebookSide = { text: "", createdAt: Date.now() };
      notebook.sides.push(side);
      await save();
      return side;
    },

    async setSideText(id: string, sideIndex: number, text: string): Promise<boolean> {
      const notebook = notebooks.get(id);
      if (!notebook) return false;
      const side = notebook.sides[sideIndex];
      if (!side) return false;

      side.text = text;
      await save();
      return true;
    },

    /**
     * Betlarni almashtiradi/qo'shadi va orqaga qaytarish uchun tarix yozadi.
     *
     * `changes` indekslari o'sish tartibida bo'lishi kerak: mavjud betlar
     * almashtiriladi, `sides.length` dan boshlab esa yangi bet qo'shiladi.
     */
    async applySides(id: string, changes: { index: number; text: string }[], label: string): Promise<boolean> {
      const notebook = notebooks.get(id);
      if (!notebook || changes.length === 0) return false;

      const before: { index: number; text: string }[] = [];
      let addedSides = 0;
      for (const change of changes) {
        if (change.index < 0 || change.index > notebook.sides.length) return false;
        if (change.index === notebook.sides.length) {
          if (usedSidesOf(notebook) >= capacityOf(notebook)) return false;
          notebook.sides.push({ text: change.text, createdAt: Date.now() });
          addedSides += 1;
          continue;
        }
        before.push({ index: change.index, text: notebook.sides[change.index].text });
        notebook.sides[change.index].text = change.text;
      }
      if (before.length === 0 && addedSides === 0) return false;

      const history = notebook.history ?? [];
      // Yangi bet qo'shilgan bo'lsa, orqaga qaytarishda uni o'chirish uchun
      // indeksni ham yozib qo'yamiz (matni bo'sh — tiklanadigan narsa yo'q).
      if (addedSides > 0) before.push({ index: notebook.sides.length - 1, text: "" });
      history.push({ at: Date.now(), label, before, addedSides });
      notebook.history = history.slice(-MAX_EDIT_HISTORY);

      await save();
      return true;
    },

    async undo(id: string): Promise<NotebookEdit | null> {
      const notebook = notebooks.get(id);
      if (!notebook) return null;
      const history = notebook.history ?? [];
      const edit = history.pop();
      if (!edit) return null;

      for (const entry of edit.before) {
        const side = notebook.sides[entry.index];
        if (side) side.text = entry.text;
      }
      for (let index = 0; index < edit.addedSides; index += 1) notebook.sides.pop();
      notebook.history = history;

      await save();
      return edit;
    },

    lastEdit(id: string): NotebookEdit | undefined {
      const notebook = notebooks.get(id);
      const history = notebook?.history ?? [];
      return history[history.length - 1];
    },

    async create(input: NotebookCreateInput): Promise<Notebook> {
      const existing = Array.from(notebooks.values()).filter((notebook) => notebook.chatId === input.chatId);
      const notebook: Notebook = {
        id: nextId(),
        chatId: input.chatId,
        sheets: input.sheets,
        paper: input.paper ?? "lined",
        title: (input.title ? cleanTitle(input.title) : null) ?? `${existing.length + 1}-daftar`,
        createdAt: Date.now(),
        sides: [],
      };
      notebooks.set(notebook.id, notebook);
      await save();
      return notebook;
    },

    async rename(id: string, title: string): Promise<boolean> {
      const notebook = notebooks.get(id);
      if (!notebook) return false;
      const cleaned = cleanTitle(title);
      if (!cleaned) return false;

      notebook.title = cleaned;
      await save();
      return true;
    },

    setActive(chatId: number, id: string | null): void {
      if (!id) {
        active.delete(chatId);
        return;
      }
      const notebook = notebooks.get(id);
      if (!notebook || notebook.chatId !== chatId) {
        active.delete(chatId);
        return;
      }
      active.set(chatId, id);
    },

    activeId(chatId: number): string | undefined {
      return active.get(chatId);
    },

    async remove(id: string): Promise<boolean> {
      const notebook = notebooks.get(id);
      if (!notebook) return false;

      notebooks.delete(id);
      if (active.get(notebook.chatId) === id) active.delete(notebook.chatId);
      await save();
      return true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Shaxsiy yozuv uslublari ("uslubimni nusxalash")                     */
/* ------------------------------------------------------------------ */

/**
 * Foydalanuvchi o'z qo'lyozmasidan olingan va saqlangan uslub.
 *
 * `chatId` — uslubning **egasi**: ro'yxat har doim egasi bo'yicha filtrlanadi,
 * shuning uchun uslub faqat o'sha foydalanuvchiga ko'rinadi. Hamma uchun ochiq
 * shriftlar kutubxonasi (FONT_LIBRARY) bundan mustasno — u o'zgarmaydi.
 */
export interface StyleRecord {
  id: string;
  chatId: number;
  name: string;
  /** Namunaga eng yaqin topilgan ommaviy shrift — uslub shunga qo'llanadi. */
  baseFont: FontId;
  /** Shriftga qo'llanadigan shaxsiy tuzatishlar (o'lchovlardan hisoblangan). */
  personal: PersonalStyle;
  /** Odam o'qiydigan qisqa izoh: «o'ngga qiyalik 12° • qalin shtrix». */
  summary: string;
  createdAt: number;
}

export interface StyleStore {
  /** Chatning o'z uslublari (yaratilish tartibida). */
  list(chatId: number): StyleRecord[];
  /** Uslubni faqat egasi oladi: begona chat id bilan `undefined`. */
  get(chatId: number, id: string): StyleRecord | undefined;
  create(input: Omit<StyleRecord, "id" | "createdAt">): Promise<StyleRecord>;
  rename(chatId: number, id: string, name: string): Promise<StyleRecord | null>;
  remove(chatId: number, id: string): Promise<boolean>;
}

/** Uslub nomining eng katta uzunligi (tugma matniga sig'ishi uchun). */
export const STYLE_NAME_MAX = 28;

/** Bitta chat saqlashi mumkin bo'lgan uslublar soni. */
export const MAX_STYLES_PER_CHAT = 5;

interface StylesFile {
  version: number;
  styles: StyleRecord[];
}

const STYLES_VERSION = 1;

/** Uslub nomini tozalaydi (bo'sh natija — `null`). */
export function cleanStyleName(value: string): string | null {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, STYLE_NAME_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Fayldagi uslubni tekshirib, xavfsiz chegaralarga keltiradi. */
function sanitizeStyle(value: unknown): StyleRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown> & { personal?: Partial<PersonalStyle> };
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.chatId !== "number" || !Number.isFinite(raw.chatId)) return null;
  const name = typeof raw.name === "string" ? cleanStyleName(raw.name) : null;
  if (!name) return null;

  const baseFont = typeof raw.baseFont === "string" && raw.baseFont ? raw.baseFont : "caveat";
  const personal: Partial<PersonalStyle> = raw.personal ?? {};

  return {
    id: raw.id,
    chatId: raw.chatId,
    name,
    baseFont,
    personal: {
      baseFont,
      slant: Math.round(numberIn(personal.slant, -22, 22, 0) * 10) / 10,
      stretch: Math.round(numberIn(personal.stretch, 0.75, 1.35, 1) * 100) / 100,
      weight: Math.round(numberIn(personal.weight, 0.7, 1.9, 1) * 100) / 100,
      tracking: Math.round(numberIn(personal.tracking, 0.8, 1.3, 1) * 100) / 100,
      wobble: Math.round(numberIn(personal.wobble, 0.2, 1, 0.35) * 100) / 100,
      drift: Math.round(numberIn(personal.drift, 0, 8, 0) * 10) / 10,
      sizeScale: Math.round(numberIn(personal.sizeScale, 0.8, 1.3, 1) * 100) / 100,
    },
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 120) : "",
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

export async function createStyleStore(dataDir: string): Promise<StyleStore> {
  const file = join(dataDir, "styles.json");
  const records = new Map<string, StyleRecord>();

  async function load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as Partial<StylesFile>)?.styles as unknown[] | undefined) ?? [];
      if (!Array.isArray(list)) {
        console.warn("styles.json formati kutilganidek emas — bo'sh baza ishlatiladi");
        return;
      }
      for (const item of list) {
        const record = sanitizeStyle(item);
        if (record) records.set(record.id, record);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") console.warn("styles.json o'qilmadi:", (error as Error).message);
    }
  }

  async function save(): Promise<void> {
    try {
      await mkdir(dataDir, { recursive: true });
      const payload: StylesFile = { version: STYLES_VERSION, styles: Array.from(records.values()) };
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
      await rename(tmp, file);
    } catch (error) {
      console.warn("styles.json saqlanmadi:", (error as Error).message);
    }
  }

  function nextId(): string {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const id = `st${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
      if (!records.has(id)) return id;
    }
    return `st${Date.now().toString(36)}${records.size}`;
  }

  await load();

  return {
    list(chatId: number): StyleRecord[] {
      return Array.from(records.values())
        .filter((record) => record.chatId === chatId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },

    get(chatId: number, id: string): StyleRecord | undefined {
      const record = records.get(id);
      // Egalikni tekshiramiz: boshqa chatning uslubi hech qachon qaytmaydi.
      return record && record.chatId === chatId ? record : undefined;
    },

    async create(input: Omit<StyleRecord, "id" | "createdAt">): Promise<StyleRecord> {
      const sanitized = sanitizeStyle({ ...input, id: nextId(), createdAt: Date.now() });
      if (!sanitized) throw new Error("Uslub ma'lumotlari to'g'ri emas.");
      records.set(sanitized.id, sanitized);
      await save();
      return sanitized;
    },

    async rename(chatId: number, id: string, name: string): Promise<StyleRecord | null> {
      const record = records.get(id);
      if (!record || record.chatId !== chatId) return null;
      const cleaned = cleanStyleName(name);
      if (!cleaned) return null;
      record.name = cleaned;
      await save();
      return record;
    },

    async remove(chatId: number, id: string): Promise<boolean> {
      const record = records.get(id);
      if (!record || record.chatId !== chatId) return false;
      records.delete(id);
      await save();
      return true;
    },
  };
}
