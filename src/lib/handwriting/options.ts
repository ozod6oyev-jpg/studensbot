import {
  FONT_LIBRARY,
  fontEntry,
  type FontCategory,
  type FontLibraryEntry,
} from "./fonts.generated";
import { createRng } from "./rng";
import type { FontId, InkColor, NotebookStyle, PageFormat, PaperType } from "./types";

export const PAPER_OPTIONS: { id: PaperType; label: string; hint: string }[] = [
  { id: "lined", label: "Yo'l-yo'l", hint: "Chiziqli daftar — adabiyot, insho, diktant" },
  { id: "grid", label: "Katak", hint: "Katak daftar — matematika, algebra, geometriya" },
  { id: "plain", label: "Toza", hint: "Chiziqsiz oq varaq" },
];

/** Siyoh ranglari — maksimum 10 ta (hammasi bir-biridan ajralib turadi). */
export const INK_OPTIONS: { id: InkColor; label: string; hex: string }[] = [
  { id: "blue", label: "Ko'k ruchka", hex: "#1B3E8F" },
  { id: "black", label: "Qora ruchka", hex: "#1F1F26" },
  { id: "graphite", label: "Qalam", hex: "#4B4B55" },
  { id: "green", label: "Yashil", hex: "#1F6B4A" },
  { id: "red", label: "Qizil", hex: "#B3253B" },
  { id: "purple", label: "Siyohrang", hex: "#5B3A8E" },
  { id: "orange", label: "To'q sariq", hex: "#C2571A" },
  { id: "pink", label: "Pushti", hex: "#C2185B" },
  { id: "teal", label: "Havorang", hex: "#0E7490" },
  { id: "brown", label: "Jigarrang", hex: "#6B4226" },
];

/* ------------------------------------------------------------------ */
/* Shriftlar kutubxonasi                                               */
/* ------------------------------------------------------------------ */

export const FONT_CATEGORIES: { id: FontCategory; label: string; hint: string }[] = [
  { id: "erkin", label: "Erkin qo'lyozma", hint: "Tez, bemalol yozilgan — kundalik daftar uslubi" },
  { id: "ozoda", label: "Ozoda yozuv", hint: "Tekis va o'qishga qulay — nazorat ishi, diktant" },
  { id: "bosma", label: "Bosma (pechat) uslub", hint: "Harflar alohida-alohida — kichik sinflar uchun" },
  { id: "kursiv", label: "Kitobiy kursiv", hint: "Qiyalik bilan bog'langan chiroyli yozuv" },
  { id: "brus", label: "Mo'yqalam va bo'r", hint: "Qalin, ta'sirchan shtrixlar — sarlavha va e'lon" },
  { id: "bolalar", label: "Bolalar yozuvi", hint: "Yumaloq, quvnoq harflar — boshlang'ich sinf" },
];

export function categoryLabel(category: FontCategory): string {
  return FONT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function fontsInCategory(category: FontCategory): FontLibraryEntry[] {
  return FONT_LIBRARY.filter((entry) => entry.category === category);
}

export function fontLabel(id: FontId): string {
  return fontEntry(id)?.family ?? id;
}

export function fontSupportsCyrillic(id: FontId): boolean {
  return fontEntry(id)?.cyrillic ?? false;
}

/** Bot va boshqa matnli interfeyslar uchun qisqa ro'yxat. */
export const FONT_OPTIONS: { id: FontId; label: string; hint: string }[] = FONT_LIBRARY.map((entry) => ({
  id: entry.id,
  label: entry.family,
  hint: `${categoryLabel(entry.category)}${entry.cyrillic ? " • kirillcha ishlaydi" : ""}`,
}));

/** Fan bo'yicha tayyor kombinatsiyalar (Studio va bot takliflari uchun). */
export const SUBJECT_PRESETS: {
  id: "adabiyot" | "matematika";
  label: string;
  hint: string;
  style: { paper: PaperType; font: FontId };
}[] = [
  {
    id: "adabiyot",
    label: "Adabiyot",
    hint: "Chiziqli daftar va ozoda yozuv — she'r, insho, diktant",
    style: { paper: "lined", font: "marckscript" },
  },
  {
    id: "matematika",
    label: "Matematika",
    hint: "Katak daftar va erkin yozuv — tenglama, misol, formula",
    style: { paper: "grid", font: "caveat" },
  },
];

export const PAGE_FORMAT_OPTIONS: { id: PageFormat; label: string; width: number; height: number }[] = [
  { id: "a4", label: "A4", width: 1240, height: 1754 },
  { id: "a5", label: "A5", width: 874, height: 1240 },
  { id: "square", label: "Kvadrat", width: 1240, height: 1240 },
];

/** `strip` — faqat namuna ko'rsatish uchun kichik varaqa (galereya plitkalari). */
export const STRIP_FORMAT: { id: PageFormat; label: string; width: number; height: number } = {
  id: "strip",
  label: "Namuna",
  width: 900,
  height: 240,
};

export function pageSizeFor(format: PageFormat) {
  if (format === STRIP_FORMAT.id) return { width: STRIP_FORMAT.width, height: STRIP_FORMAT.height };
  const found = PAGE_FORMAT_OPTIONS.find((option) => option.id === format) ?? PAGE_FORMAT_OPTIONS[0];
  return { width: found.width, height: found.height };
}

export function inkHex(ink: InkColor) {
  return INK_OPTIONS.find((option) => option.id === ink)?.hex ?? "#1B3E8F";
}

/**
 * «Boshqacha yozsin» uchun yangi variant: boshqa qo'lyozma shrifti va yangi
 * urug' (`seed`).
 *
 * Faqat `seed` o'zgarganda varaqa deyarli bir xil ko'rinadi — chiziqlar va
 * harflar bir necha pikselgina siljiydi, ya'ni foydalanuvchi «hech narsa
 * o'zgarmadi» deb o'ylaydi. Shuning uchun ko'rinadigan o'zgarish uchun shrift
 * ham almashtiriladi. Tanlov `seed` orqali aniqlanadi — natija takrorlanadi va
 * tekshiriladi. Joriy shriftdan boshqa shrift yo'q bo'lsa, uslub o'zgarmaydi.
 */
export function shuffleHandwriting(
  style: Pick<NotebookStyle, "font" | "seed">,
  seed: number,
): Pick<NotebookStyle, "font" | "seed"> {
  const others = FONT_LIBRARY.map((entry) => entry.id).filter((id) => id !== style.font);
  if (others.length === 0) return { font: style.font, seed };

  const rng = createRng(seed);
  const index = Math.min(others.length - 1, Math.floor(rng.next() * others.length));
  return { font: others[index] ?? style.font, seed };
}
