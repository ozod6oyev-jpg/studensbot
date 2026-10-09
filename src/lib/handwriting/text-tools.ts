/**
 * Matn ustidagi toza (side-effect'siz) amallar — Studio asboblari uchun.
 *
 * Bu funksiyalar hech narsani import qilmaydi va matnni o'zgartirmaydi: yangi
 * matn qaytaradi. Shu sababli ularni `scripts/check-text.ts` da alohida
 * tekshirish mumkin — Studio'dagi asboblar shu yerga tayanadi, ya'ni matn
 * buzilmasligi shu funksiyalarda kafolatlanadi.
 *
 * Qatorlar ajratgichi har doim `\n` (Windows'dagi `\r\n` ham shunga
 * keltiriladi): chizuvchi har bir qatorni daftarda alohida satr qiladi va
 * oxiridagi `\r` belgisi ko'rinmas nuqson bo'lib qolardi.
 */

export type CaseMode = "upper" | "lower" | "title";

export interface TextStats {
  /** Matn uzunligi (bo'shliqlar bilan) — maydondagi belgilar soni. */
  chars: number;
  /** Chetdagi bo'shliqlarsiz uzunlik — bot aynan shuni tekshiradi. */
  trimmed: number;
  /** So'zlar soni (bo'shliq, tab va qator bilan ajralgan). */
  words: number;
  /** Qatorlar soni (bo'shlar ham kiradi). */
  lines: number;
  /** Matni bor qatorlar. */
  filled: number;
  /** Bo'sh (yoki faqat bo'shliqdan iborat) qatorlar. */
  empty: number;
  /** Eng uzun qatorning uzunligi — daftarga sig'masligini oldindan ko'rish. */
  longest: number;
}

/** Matnni `\n` bilan ajratilgan qatorlarga bo'ladi (bo'sh matn — bo'sh ro'yxat). */
export function textLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** Matn haqida qisqa raqamlar: Studio'dagi hisoblagich shundan foydalanadi. */
export function textStats(text: string): TextStats {
  const lines = textLines(text);
  const trimmed = text.trim();
  return {
    chars: text.length,
    trimmed: trimmed.length,
    words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
    lines: lines.length,
    filled: lines.filter((line) => line.trim().length > 0).length,
    empty: lines.filter((line) => line.trim().length === 0).length,
    longest: lines.reduce((max, line) => Math.max(max, line.length), 0),
  };
}

/** Hisoblagich uchun qisqa izoh: «12 qator · 48 so'z · 320 belgi». */
export function statsSummary(stats: TextStats): string {
  return `${stats.filled} qator · ${stats.words} so'z · ${stats.chars} belgi`;
}

/** Har bir qatorning boshidagi va oxiridagi bo'shliqni olib tashlaydi. */
export function trimLines(text: string): string {
  return textLines(text)
    .map((line) => line.trim())
    .join("\n");
}

/** Ketma-ket kelgan bo'sh qatorlarni bittaga qisqartiradi (oxiridagisini ham). */
export function collapseBlankLines(text: string): string {
  const lines = textLines(text).map((line) => line.trim());
  const kept: string[] = [];
  for (const line of lines) {
    const blank = line.length === 0;
    if (blank && kept.length > 0 && kept[kept.length - 1] === "") continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  return kept.join("\n");
}

/** Bo'sh qatorlarni butunlay olib tashlaydi (matn zich joylashadi). */
export function removeEmptyLines(text: string): string {
  return textLines(text)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Registrni o'zgartiradi: butun matn katta (`upper`), kichik (`lower`) yoki har
 * bir so'z bosh harf bilan (`title`).
 *
 * `title` da so'zning qolgan harflariga tegilmaydi — aks holda qisqartmalar
 * (`A. Oripov`, `x^2`) buzilib ketardi. Apostrof (`o'zbek`) so'zni ajratmaydi:
 * bo'shliq, tab va qatorgina ajratgich hisoblanadi.
 */
export function changeCase(text: string, mode: CaseMode): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  return text.replace(/(^|[\s])(\S)/gu, (_match, space: string, letter: string) => {
    return `${space}${letter.toUpperCase()}`;
  });
}

/** Matnni foydalanuvchi ko'rgan holatiga qaytarish uchun nusxa (asboblar uchun). */
export function hasText(text: string): boolean {
  return text.trim().length > 0;
}
