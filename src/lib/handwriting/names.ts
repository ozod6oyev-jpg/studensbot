/**
 * Shrift nomlarini ko'rsatish uchun umumiy yordamchilar.
 *
 * Bot, shrift varaqasi (`font-sheet.ts`) va boshqa matnli interfeyslar shu
 * funksiyalardan foydalanadi — nom formatlash bitta joyda turishi kerak.
 * Diqqat: bu fayl `options.ts` tomonidan import qilinmaydi (aylanma import
 * bo'lmasligi uchun) — faqat tashqi iste'molchilar chaqiradi.
 */
import { fontEntry } from "./fonts.generated";
import { categoryLabel } from "./options";
import type { FontId } from "./types";

/** Shriftning ko'rsatiladigan qisqa nomi: "Marck Script — ozoda yozuv" → "Marck Script". */
export function fontDisplayName(id: FontId): string {
  const entry = fontEntry(id);
  if (!entry) return id;
  const short = entry.label.split(" — ")[0];
  return short || entry.family || id;
}

/** Bir qatorli tavsif: "Caveat • Erkin qo'lyozma • kirill ✓". */
export function fontSummary(id: FontId): string {
  const entry = fontEntry(id);
  if (!entry) return id;
  return `${fontDisplayName(id)} • ${categoryLabel(entry.category)}${entry.cyrillic ? " • kirill ✓" : ""}`;
}
