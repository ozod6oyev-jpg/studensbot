/**
 * Daftarni "kitob" qilib yuklab olish: yozilgan betlarni A4 PDF sahifalariga
 * aylantiradi.
 *
 * Har bir bet alohida chiziladi — varaqning old tomoni `recto` (chegara chapda),
 * orqa tomoni `verso` (chegara o'ngda) bo'lib, daftardagi tartib saqlanadi.
 * Natija JPEG sahifalardan iborat PDF; juda katta daftarlarda hujjat bir necha
 * qismga bo'linadi (`volumeBytes` byudjeti), chunki Telegram bitta fayl uchun
 * ~50 MB chegara qo'yadi.
 */
import jpeg from "jpeg-js";
import { buildPdf, type PdfImagePage } from "./pdf";
import { renderNotebook } from "./render";
import { DEFAULT_STYLE, type FontId, type NotebookStyle, type PageSide } from "./types";

export interface NotebookPdfSide {
  text: string;
  /** Varaqning tomoni: old (chegara chapda) yoki orqa (chegara o'ngda). */
  side: PageSide;
}

export interface NotebookPdfInput {
  title?: string;
  sides: NotebookPdfSide[];
  style?: Partial<NotebookStyle>;
  fonts: Partial<Record<FontId, Uint8Array | ArrayBuffer>>;
  /** JPEG sifati (0–1). Standart 0.72 — matn aniq ko'rinadi, hajm kichik. */
  quality?: number;
  /** Bitta qismdagi eng katta hajm (bayt). Standart 18 MB. */
  volumeBytes?: number;
  /** Har bir bet chizilgandan keyin chaqiriladi (masalan, jarayonni ko'rsatish uchun). */
  onPage?: (done: number, total: number) => void | Promise<void>;
}

export interface NotebookPdfVolume {
  pdf: Uint8Array;
  /** Qismdagi sahifalar soni. */
  pages: number;
  /** Qismga kirgan betlar (0 dan boshlanadigan indekslar, `sides` bo'yicha). */
  from: number;
  to: number;
}

export const DEFAULT_PDF_QUALITY = 0.72;
export const DEFAULT_PDF_VOLUME_BYTES = 18 * 1024 * 1024;

/**
 * Sahifa hajmlarini byudjetga qarab qismlarga bo'ladi (indekslar guruhlari).
 * Har bir qismda kamida bitta sahifa bo'ladi — bitta sahifa byudjetdan katta
 * bo'lsa ham u alohida qism bo'lib qoladi.
 */
export function groupByBudget(sizes: number[], budget: number): number[][] {
  if (sizes.length === 0) return [];
  const limit = Math.max(1, budget);
  const groups: number[][] = [];
  let current: number[] = [];
  let used = 0;

  sizes.forEach((size, index) => {
    const cost = Math.max(0, size);
    if (current.length > 0 && used + cost > limit) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += cost;
  });
  if (current.length > 0) groups.push(current);
  return groups;
}

/** RGBA piksellarni JPEG baytlariga aylantiradi. */
function encodeJpeg(rgba: Uint8ClampedArray, width: number, height: number, quality: number): Uint8Array {
  const encoded = jpeg.encode({ data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height }, Math.round(quality * 100));
  return new Uint8Array(encoded.data);
}

/**
 * Daftar betlarini PDF qismlariga aylantiradi.
 *
 * `sides` — faqat yozilgan betlar (bo'sh betlar chaqiruvchi tomonidan
 * tashlab yuboriladi). Bet bir varaqqa sig'masa (matn o'zgargandan keyin),
 * uning barcha varaqalari kitobga ketma-ket qo'shiladi.
 */
export async function renderNotebookPdf(
  input: NotebookPdfInput,
): Promise<{ volumes: NotebookPdfVolume[]; pages: number }> {
  if (input.sides.length === 0) throw new Error("renderNotebookPdf: yozilgan betlar yo'q.");

  const style: NotebookStyle = { ...DEFAULT_STYLE, ...input.style };
  const quality = input.quality ?? DEFAULT_PDF_QUALITY;
  const budget = input.volumeBytes ?? DEFAULT_PDF_VOLUME_BYTES;

  // Har bir bet uchun sahifalar (odatda bitta) tayyorlanadi.
  const images: PdfImagePage[] = [];
  const owner: number[] = [];
  for (let index = 0; index < input.sides.length; index += 1) {
    const side = input.sides[index];
    const result = await renderNotebook({
      text: side.text,
      style: { ...style, startSide: side.side },
      fonts: input.fonts,
    });
    for (const page of result.pages) {
      images.push({
        jpeg: encodeJpeg(page.rgba, page.width, page.height, quality),
        width: page.width,
        height: page.height,
      });
      owner.push(index);
    }
    await input.onPage?.(index + 1, input.sides.length);
  }

  const groups = groupByBudget(
    images.map((image) => image.jpeg.length),
    budget,
  );

  const volumes: NotebookPdfVolume[] = groups.map((group, volumeIndex) => {
    const selected = group.map((imageIndex) => images[imageIndex]);
    const title = input.title?.trim() || "Daftar";
    const label = groups.length > 1 ? `${title} — ${volumeIndex + 1}-qism` : title;
    return {
      pdf: buildPdf(selected, { title: label }),
      pages: selected.length,
      from: owner[group[0]],
      to: owner[group[group.length - 1]],
    };
  });

  return { volumes, pages: images.length };
}

/** Fayl nomi uchun xavfsiz matn: faqat lotin harflari, raqamlar va `-`. */
export function slugifyTitle(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return ascii.length > 0 ? ascii.toLowerCase() : "daftar";
}
