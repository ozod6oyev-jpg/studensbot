import type { FontId, NotebookStyle, RenderResult } from "./types";
import { renderNotebook } from "./render";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "./fonts.generated";

/**
 * Kutubxonadagi barcha shriftlar Vite orqali "URL import" sifatida
 * ro'yxatga olinadi: brauzer faqat kerak bo'lgan shriftni yuklab oladi,
 * qolganlari tarmoqqa umuman chiqmaydi.
 */
const fontUrls = import.meta.glob("../../assets/fonts/*.ttf", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const fontCache = new Map<FontId, Promise<Uint8Array>>();

function urlFor(id: FontId): string | undefined {
  const entry = fontEntry(id);
  if (!entry) return undefined;
  return fontUrls[`../../assets/fonts/${entry.file}`];
}

/** Shrift faylini bir marta yuklaydi va keshlaydi. */
export function loadFontBytes(id: FontId): Promise<Uint8Array> {
  const cached = fontCache.get(id);
  if (cached) return cached;

  const promise = (async () => {
    const url = urlFor(id);
    if (!url) {
      throw new Error(`"${id}" shrifti kutubxonada topilmadi`);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Shrift yuklanmadi: ${fontEntry(id)?.file ?? id}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  })();

  fontCache.set(id, promise);
  return promise;
}

/** Kutubxonadagi shriftlar soni (UI uchun qulaylik). */
export function librarySize(): number {
  return FONT_LIBRARY.length;
}

/** Brauzerda ishlaydigan qulaylik qatlami: shriftlarni o'zi yuklaydi. */
export async function renderNotebookInBrowser(
  text: string,
  style: Partial<NotebookStyle> = {},
): Promise<RenderResult> {
  const fonts: Partial<Record<FontId, Uint8Array>> = {};
  const needed: FontId[] = [style.font ?? FALLBACK_FONT_ID, FALLBACK_FONT_ID].filter(
    (id, index, list) => list.indexOf(id) === index,
  );

  const loaded = await Promise.all(needed.map((id) => loadFontBytes(id).catch(() => null)));
  needed.forEach((id, index) => {
    const bytes = loaded[index];
    if (bytes) fonts[id] = bytes;
  });

  if (Object.keys(fonts).length === 0) {
    throw new Error("Shriftlarni yuklab bo'lmadi");
  }

  return renderNotebook({ text, style, fonts });
}

/** PNG baytlarini <img src> uchun obyekt havolasiga aylantiradi. */
export function pngToObjectUrl(png: Uint8Array): string {
  const copy = new Uint8Array(png.byteLength);
  copy.set(png);
  return URL.createObjectURL(new Blob([copy], { type: "image/png" }));
}

export function downloadPng(result: RenderResult, filename = "daftar.png") {
  const page = result.pages[0];
  if (!page) return;
  const url = pngToObjectUrl(page.png);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
