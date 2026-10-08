/**
 * Namunaga eng yaqin shriftni tanlash va shaxsiy uslubni hisoblash.
 *
 * Har bir nomzod shrift **o'lchanadi**: u bilan varaqa chiziladi va xuddi
 * foydalanuvchi namunasi kabi tahlil qilinadi (`analyzeSample`). Shundan keyin
 * o'lchovlar taqqoslanadi — qiyaligi, shtrix qalinligi, zichligi va x-balandligi
 * bo'yicha eng yaqin shrift tanlanadi. Tanlangan shriftga foydalanuvchining
 * farqlari (qiyalik, cho'zilish, qalinlik, oraliq, tebranish) qo'llanadi.
 *
 * Diqqat: bu to'liq "shrift yasash" emas — natija foydalanuvchi qo'liga
 * moslashtirilgan o'lchovlar to'plami (`PersonalStyle`).
 */
import { FALLBACK_FONT_ID, fontEntry } from "./fonts.generated";
import { renderNotebook } from "./render";
import { analyzeSample, type SampleImage, type SampleProfile } from "./sample";
import { DEFAULT_STYLE, type FontId, type PersonalStyle } from "./types";

/** Nomzodlarni o'lchash uchun namuna matni (har xil harf balandliklari uchun). */
const MEASURE_TEXT = "Abcdegkmnopqrsta hijkwxyz ABCDEFG Ko'rinish dartslari 01234";
/** O'lchash varaqasi uslubi: chiziqlarsiz toza qog'oz (chiziqlar o'lchovni buzadi). */
const MEASURE_STYLE = {
  paper: "plain" as const,
  marginLine: false,
  pageFormat: "strip" as const,
  fontSize: 44,
  wobble: 0.35,
  seed: 11,
  mathMode: false,
};

export interface CandidateMeasurement {
  id: FontId;
  profile: SampleProfile;
  /** Namunaga masofa (kichikroq — yaqinroq). */
  distance: number;
}

export interface CalibrationResult {
  /** Eng yaqin shrift (o'lchovlar bo'yicha). */
  baseFont: FontId;
  /** Asosiy shriftning o'lchovlari. */
  baseProfile: SampleProfile;
  /** Shriftga qo'llanadigan shaxsiy tuzatishlar. */
  personal: PersonalStyle;
  /** Barcha nomzodlar masofa bo'yicha (eng yaqini birinchi). */
  candidates: CandidateMeasurement[];
}

function ratio(value: number, reference: number): number {
  if (!(reference > 0) || !Number.isFinite(value) || value <= 0) return 1;
  return value / reference;
}

/** Ikki o'lchov orasidagi masofa (nisbatlar bo'yicha, shkaladan mustaqil). */
function distanceBetween(user: SampleProfile, candidate: SampleProfile): number {
  return (
    1.2 * Math.abs(user.slant - candidate.slant) / 10 +
    1.0 * Math.abs(ratio(user.thickness, candidate.thickness) - 1) +
    0.9 * Math.abs(ratio(user.aspect, candidate.aspect) - 1) +
    0.5 * Math.abs(ratio(user.coverage, candidate.coverage) - 1) +
    0.5 * Math.abs(ratio(user.tracking, candidate.tracking) - 1) +
    0.7 * Math.abs(ratio(user.xHeight, candidate.xHeight) - 1)
  );
}

/** Shrift bilan namuna matnini chizib, o'lchovlarini qaytaradi. */
export async function measureFont(
  id: FontId,
  fonts: Partial<Record<FontId, Uint8Array | ArrayBuffer>>,
): Promise<SampleProfile | null> {
  try {
    const result = await renderNotebook({
      text: MEASURE_TEXT,
      style: { ...DEFAULT_STYLE, ...MEASURE_STYLE, font: id },
      fonts,
    });
    if (result.pages.length === 0) return null;
    const page = result.pages[0];
    const image: SampleImage = { width: page.width, height: page.height, data: page.rgba };
    const profile = analyzeSample(image);
    return profile.thickness > 0 ? profile : null;
  } catch (error) {
    console.warn(`"${id}" shriftini o'lchab bo'lmadi:`, (error as Error).message);
    return null;
  }
}

/**
 * Namunani nomzod shriftlar bilan taqqoslab, eng yaqinini tanlaydi va shaxsiy
 * uslubni hisoblaydi. `fonts` da baytlari yo'q shriftlar o'tkazib yuboriladi;
 * birortasi ham o'lchanmasa, zaxira shrift ishlatiladi.
 */
export async function calibrateStyle(input: {
  profile: SampleProfile;
  fonts: Partial<Record<FontId, Uint8Array | ArrayBuffer>>;
  /** Faqat shu shriftlarni sinash (masalan, faqat kirillni biladiganlar). */
  candidateIds?: FontId[];
  onProgress?: (done: number, total: number) => void | Promise<void>;
}): Promise<CalibrationResult> {
  const ids = (input.candidateIds ?? Object.keys(input.fonts)).filter((id) => Boolean(input.fonts[id]));
  const candidates: CandidateMeasurement[] = [];

  let done = 0;
  for (const id of ids) {
    const profile = await measureFont(id, input.fonts);
    done += 1;
    if (profile) {
      candidates.push({ id, profile, distance: distanceBetween(input.profile, profile) });
    }
    await input.onProgress?.(done, ids.length);
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best) {
    throw new Error("Shriftlarni o'lchab bo'lmadi — shrift fayllari yuklanmagan.");
  }

  return {
    baseFont: best.id,
    baseProfile: best.profile,
    personal: derivePersonalStyle(input.profile, best.profile, best.id),
    candidates,
  };
}

/** 0 dan 1 gacha chegaralash. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Qiyalik o'lchovi katta burchaklarda biroz kam baholaydi (shtrixlar bir-biriga
 * qo'shilib ketadi), shuning uchun tuzatmani shu koeffitsient bilan oshiramiz.
 * `check-style.ts` dagi round-trip tekshiruvi shu qiymatga tayanadi.
 */
const SLANT_GAIN = 1.35;

/**
 * Namunadagi farqlarni shriftga qo'llanadigan tuzatishlarga aylantiradi:
 * qiyalik — gradusda, qalinlik/cho'zilish/oraliq/o'lcham — nisbatda.
 */
export function derivePersonalStyle(
  user: SampleProfile,
  base: SampleProfile,
  baseFont: FontId,
): PersonalStyle {
  const thicknessRatio = ratio(user.thickness, base.thickness);
  const trackingRatio = ratio(user.tracking, base.tracking);
  const xHeightRatio = ratio(user.xHeight, base.xHeight);

  // Cho'zilish: harf shakllarining nisbati (kenglik / balandlik) bo'yicha.
  // Eslatma: bu o'lchov kuchsiz ravishda oraliqqa ham bog'liq (keng oraliqda
  // qo'shni harflar ajralib, bo'laklar kichrayadi), shuning uchun natija taxminiy
  // — `check-style.ts` dagi "qaytarib olish" tekshiruvi shuni o'lchaydi.
  const stretch = clamp(ratio(user.aspect, base.aspect), 0.75, 1.35);

  return {
    baseFont,
    slant: Math.round(clamp((user.slant - base.slant) * SLANT_GAIN, -22, 22) * 10) / 10,
    stretch: Math.round(stretch * 100) / 100,
    weight: Math.round(clamp(thicknessRatio, 0.7, 1.9) * 100) / 100,
    tracking: Math.round(clamp(trackingRatio, 0.8, 1.3) * 100) / 100,
    // Tebranish namunadagi satr beqarorligidan olinadi (0.25–0.95 oralig'ida).
    wobble: Math.round(clamp(0.3 + user.wobble * 5, 0.3, 0.95) * 100) / 100,
    // Asosiy chiziqdan siljish pikselda (o'lcham 34px atrofida).
    drift: Math.round(clamp(user.wobble * 60, 0, 6) * 10) / 10,
    sizeScale: Math.round(clamp(xHeightRatio, 0.8, 1.3) * 100) / 100,
  };
}

/** Shaxsiy uslubni odam o'qiy oladigan qisqa izohga aylantiradi. */
export function personalSummary(personal: PersonalStyle): string {
  const parts: string[] = [];
  if (Math.abs(personal.slant) >= 2) {
    parts.push(personal.slant > 0 ? `o'ngga qiyalik ${personal.slant}°` : `chapga qiyalik ${Math.abs(personal.slant)}°`);
  } else {
    parts.push("tik yozuv");
  }
  if (personal.weight > 1.12) parts.push("qalin shtrix");
  else if (personal.weight < 0.88) parts.push("ingichka shtrix");
  if (personal.stretch > 1.08) parts.push("keng harflar");
  else if (personal.stretch < 0.92) parts.push("tor harflar");
  if (personal.tracking > 1.08) parts.push("keng oraliq");
  else if (personal.tracking < 0.92) parts.push("zich harflar");
  if (personal.sizeScale > 1.08) parts.push("yirik yozuv");
  else if (personal.sizeScale < 0.92) parts.push("mayda yozuv");
  return parts.join(" • ");
}

/** Zaxira shrift (o'lchov imkonsiz bo'lsa ishlatiladi). */
export const CALIBRATION_FALLBACK_FONT: FontId = FALLBACK_FONT_ID;

/** Shrift nomi (hisobot uchun). */
export function fontNameOf(id: FontId): string {
  return fontEntry(id)?.family ?? id;
}
