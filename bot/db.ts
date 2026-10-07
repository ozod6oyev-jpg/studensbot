/**
 * Daftar bazasi — har bir chat uchun "daftar" (notebook) yozuvlari.
 *
 * Foydalanuvchi yangi daftar yaratadi (12/36/48/96 varaq), keyin yozgan
 * matni varaq tomonlariga ketma-ket joylashadi. Har bir varaq ikki tomondan
 * iborat: juft indeks — old tomon (chegara chapda), toq indeks — orqa tomon
 * (chegara o'ngda).
 *
 * Ma'lumot `${dataDir}/notebooks.json` faylida saqlanadi. Yozish atomar:
 * avval vaqtinchalik faylga yoziladi, keyin nomi almashtiriladi — shu tufayli
 * jarayon o'rtada to'xtab qolsa ham fayl buzilmaydi.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type NotebookSheets = 12 | 36 | 48 | 96;

/** Yangi daftar yaratishda taklif qilinadigan varaq sonlari. */
export const SHEET_CHOICES: NotebookSheets[] = [12, 36, 48, 96];

export interface NotebookSide {
  text: string;
  createdAt: number;
}

export interface Notebook {
  id: string;
  chatId: number;
  /** Daftardagi varaq soni (har bir varaq = 2 tomon). */
  sheets: NotebookSheets;
  title: string;
  createdAt: number;
  /** index i: juft — old tomon (recto), toq — orqa tomon (verso). */
  sides: NotebookSide[];
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
  create(input: { chatId: number; sheets: NotebookSheets; title?: string }): Promise<Notebook>;
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
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "daftar",
    createdAt: typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    // Varaq sonidan ortiq tomon bo'lsa (fayl qo'lda tahrirlangan bo'lishi mumkin) — kesamiz.
    sides: sides.slice(0, sheets * 2),
  };
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

    async create(input: { chatId: number; sheets: NotebookSheets; title?: string }): Promise<Notebook> {
      const existing = Array.from(notebooks.values()).filter((notebook) => notebook.chatId === input.chatId);
      const notebook: Notebook = {
        id: nextId(),
        chatId: input.chatId,
        sheets: input.sheets,
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
