/**
 * Matnni bitta varaq tomoniga sig'adigan qismga bo'lish.
 *
 * Daftar "sahifa-sahifa" to'ldiriladi: foydalanuvchi yuborgan matn joriy
 * tomonga sig'guncha yoziladi, qolgani keyingi tomonga o'tadi. Sig'imni
 * aniqlash uchun oraliq natija chizilmaydi — faqat `layoutText` hisoblanadi
 * (u varaqalar sonini qaytaradi), shuning uchun tekshiruv tez ishlaydi.
 */
import { parseFont, type HandwritingFont } from "./font";
import { FALLBACK_FONT_ID, fontEntry } from "./fonts.generated";
import { layoutText } from "./layout";
import { DEFAULT_STYLE, type FontId, type NotebookStyle } from "./types";

export interface FitInput {
  style?: Partial<NotebookStyle>;
  fonts?: Partial<Record<FontId, Uint8Array | ArrayBuffer>>;
}

export interface FitResult {
  /** Birinchi tomonga yoziladigan qism. Bo'sh bo'lsa — hech narsa sig'madi. */
  head: string;
  /** Keyingi tomonga o'tadigan qism. */
  tail: string;
  /** Butun matn bitta tomonga sig'dimi. */
  fitsEntirely: boolean;
}

interface Handles {
  primary: HandwritingFont;
  secondary?: HandwritingFont;
  sizeScale: number;
}

/** Berilgan baytlardan tanlangan shriftni (va zaxirani) tayyorlaydi. */
function prepare(style: NotebookStyle, fonts: FitInput["fonts"]): Handles | null {
  const handles: Partial<Record<FontId, HandwritingFont>> = {};
  if (fonts) {
    for (const key of Object.keys(fonts) as FontId[]) {
      const data = fonts[key];
      if (!data) continue;
      try {
        handles[key] = parseFont(key, data);
      } catch {
        /* buzilgan shrift fayli — e'tiborsiz qoldiramiz */
      }
    }
  }

  const preferred = handles[style.font];
  const fallback = handles[FALLBACK_FONT_ID] ?? Object.values(handles)[0];
  const primary = preferred ?? fallback;
  if (!primary) return null;

  return {
    primary,
    secondary: preferred && fallback && fallback !== preferred ? fallback : undefined,
    sizeScale: fontEntry(primary.id)?.sizeScale ?? 1,
  };
}

/** Matn bitta varaqqa (bitta sahifaga) sig'adimi. */
function fitsOneSide(text: string, style: NotebookStyle, handles: Handles): boolean {
  const layout = layoutText({
    text,
    style,
    primary: handles.primary,
    secondary: handles.secondary,
    sizeScale: handles.sizeScale,
  });
  return layout.pages.length <= 1;
}

/** `limit` dan oshmaydigan oxirgi so'z chegarasi (bo'shliqdan keyingi indeks). */
function lastBreak(text: string, limit: number): number {
  for (let i = Math.min(limit, text.length); i > 0; i -= 1) {
    if (/\s/.test(text[i - 1])) return i;
  }
  return 0;
}

/**
 * Matnni bitta varaq tomoniga sig'adigan qismga bo'ladi.
 *
 * Kesim so'z chegarasida qilinadi (so'z o'rtasidan kesilmaydi), faqat bitta
 * so'zning o'zi varaqqa sig'masa — o'sha so'z ichidan kesiladi (aks holda
 * chaqiruvchi tsiklga tushib qolardi). Shrift yuklanmagan bo'lsa matn
 * bo'linmaydi: chaqiruvchi o'zi xato haqida xabar beradi.
 */
export async function fitToSingleSide(text: string, input: FitInput = {}): Promise<FitResult> {
  const body = text ?? "";
  if (body.trim().length === 0) return { head: body, tail: "", fitsEntirely: true };

  const style: NotebookStyle = { ...DEFAULT_STYLE, ...input.style };
  const handles = prepare(style, input.fonts);
  if (!handles) return { head: body, tail: "", fitsEntirely: true };

  if (fitsOneSide(body, style, handles)) return { head: body, tail: "", fitsEntirely: true };

  // Binar qidiruv: bitta tomonga sig'adigan eng katta prefiks uzunligi.
  // Prefiks uzunligi ortishi bilan qatorlar (va varaqalar) soni kamaymaydi,
  // shuning uchun qidiruv monoton.
  let low = 0;
  let high = body.length;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (fitsOneSide(body.slice(0, mid), style, handles)) low = mid;
    else high = mid;
  }
  if (low <= 0) return { head: "", tail: body, fitsEntirely: false };

  // So'z o'rtasidan kesmaslikka harakat qilamiz; iloji bo'lmasa — qisqaroq kesamiz.
  let cut = lastBreak(body, low);
  if (cut <= 0) cut = low;

  const head = body.slice(0, cut).trimEnd();
  const tail = body.slice(cut).trimStart();
  if (head.length === 0) return { head: "", tail: body, fitsEntirely: false };

  return { head, tail, fitsEntirely: false };
}
