/**
 * Namunaviy rasmni ochish: foydalanuvchi Telegram'ga yuborgan qo'lyozma
 * suratini (JPEG yoki PNG) xom RGBA piksellarga aylantiradi.
 *
 * Bot `analyzeSample()` ga aynan shu ko'rinishdagi rasm beradi, shuning uchun
 * bu modul faqat ochish (decode) bilan shug'ullanadi: JPEG — `jpeg-js` orqali,
 * PNG — Node'ning `zlib` moduli orqali (8 bitli, interlace qilinmagan PNG'lar).
 *
 * Rasm juda katta bo'lsa (telefon surati 3000+ px) u **kichraytiriladi**:
 * o'lchov uchun 1600 px yetarli, kichik rasm esa tezroq tahlil qilinadi.
 */
import jpeg from "jpeg-js";
import { inflateSync } from "node:zlib";
import type { SampleImage } from "./sample";

/** O'lchovdan oldin rasmning eng katta tomoni shu qiymatga keltiriladi. */
export const MAX_SAMPLE_SIDE = 1600;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/* ------------------------------------------------------------------ */
/* JPEG                                                                */
/* ------------------------------------------------------------------ */

function decodeJpeg(bytes: Uint8Array): SampleImage {
  const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
  if (!decoded?.data || !decoded.width || !decoded.height) {
    throw new Error("JPEG rasmni ochib bo'lmadi.");
  }
  const data = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  data.set(decoded.data.subarray(0, data.length));
  return { width: decoded.width, height: decoded.height, data };
}

/* ------------------------------------------------------------------ */
/* PNG                                                                 */
/* ------------------------------------------------------------------ */

/** PNG filtrini ochadi (0–4 turlari). `raw` — filtr baytlari olib tashlangan. */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let source = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = raw[source];
    source += 1;
    const rowStart = row * stride;
    const previousStart = rowStart - stride;

    for (let index = 0; index < stride; index += 1) {
      const value = raw[source + index];
      const left = index >= channels ? out[rowStart + index - channels] : 0;
      const up = row > 0 ? out[previousStart + index] : 0;
      const upLeft = row > 0 && index >= channels ? out[previousStart + index - channels] : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const estimate = left + up - upLeft;
          const leftDistance = Math.abs(estimate - left);
          const upDistance = Math.abs(estimate - up);
          const upLeftDistance = Math.abs(estimate - upLeft);
          const nearest =
            leftDistance <= upDistance && leftDistance <= upLeftDistance
              ? left
              : upDistance <= upLeftDistance
                ? up
                : upLeft;
          restored = value + nearest;
          break;
        }
        default:
          throw new Error(`PNG filtr turi noma'lum: ${filter}`);
      }
      out[rowStart + index] = restored & 255;
    }
    source += stride;
  }
  return out;
}

function decodePng(bytes: Uint8Array): SampleImage {
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let bitDepth = 0;
  const chunks: Uint8Array[] = [];

  while (offset + 8 <= bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) throw new Error("PNG fayli to'liq emas.");

    if (type === "IHDR") {
      width = (bytes[dataStart] << 24) | (bytes[dataStart + 1] << 16) | (bytes[dataStart + 2] << 8) | bytes[dataStart + 3];
      height =
        (bytes[dataStart + 4] << 24) |
        (bytes[dataStart + 5] << 16) |
        (bytes[dataStart + 6] << 8) |
        bytes[dataStart + 7];
      bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const interlace = bytes[dataStart + 12];
      if (bitDepth !== 8) throw new Error(`PNG ${bitDepth} bitli — faqat 8 bitli rasmlar qo'llanadi.`);
      if (interlace !== 0) throw new Error("Interlace qilingan PNG qo'llab-quvvatlanmaydi.");
      channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
      if (channels === 0) throw new Error(`PNG rang turi qo'llab-quvvatlanmaydi (${colorType}).`);
    } else if (type === "IDAT") {
      chunks.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  if (width <= 0 || height <= 0 || channels === 0) throw new Error("PNG sarlavhasi (IHDR) topilmadi.");
  if (chunks.length === 0) throw new Error("PNG ichida rasm ma'lumoti (IDAT) yo'q.");

  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    merged.set(chunk, at);
    at += chunk.length;
  }

  const raw = new Uint8Array(inflateSync(merged));
  const pixels = unfilter(raw, width, height, channels);
  const data = new Uint8ClampedArray(width * height * 4);

  for (let index = 0, pixelsAt = 0, out = 0; index < width * height; index += 1, pixelsAt += channels, out += 4) {
    if (channels === 1) {
      const gray = pixels[pixelsAt];
      data[out] = gray;
      data[out + 1] = gray;
      data[out + 2] = gray;
      data[out + 3] = 255;
    } else if (channels === 2) {
      const gray = pixels[pixelsAt];
      data[out] = gray;
      data[out + 1] = gray;
      data[out + 2] = gray;
      data[out + 3] = pixels[pixelsAt + 1];
    } else if (channels === 3) {
      data[out] = pixels[pixelsAt];
      data[out + 1] = pixels[pixelsAt + 1];
      data[out + 2] = pixels[pixelsAt + 2];
      data[out + 3] = 255;
    } else {
      data[out] = pixels[pixelsAt];
      data[out + 1] = pixels[pixelsAt + 1];
      data[out + 2] = pixels[pixelsAt + 2];
      data[out + 3] = pixels[pixelsAt + 3];
    }
  }

  return { width, height, data };
}

/* ------------------------------------------------------------------ */
/* Kichraytirish                                                       */
/* ------------------------------------------------------------------ */

/** Rasmni kataklar bo'yicha o'rtachalashtirib kichraytiradi (sifat yo'qolmaydi). */
export function shrinkImage(image: SampleImage, maxSide = MAX_SAMPLE_SIDE): SampleImage {
  const factor = Math.ceil(Math.max(image.width, image.height) / maxSide);
  if (factor <= 1) return image;

  const width = Math.max(1, Math.floor(image.width / factor));
  const height = Math.max(1, Math.floor(image.height / factor));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy += 1) {
        const sourceY = y * factor + dy;
        if (sourceY >= image.height) break;
        for (let dx = 0; dx < factor; dx += 1) {
          const sourceX = x * factor + dx;
          if (sourceX >= image.width) break;
          const at = (sourceY * image.width + sourceX) * 4;
          r += image.data[at];
          g += image.data[at + 1];
          b += image.data[at + 2];
          a += image.data[at + 3];
          count += 1;
        }
      }
      const out = (y * width + x) * 4;
      data[out] = r / count;
      data[out + 1] = g / count;
      data[out + 2] = b / count;
      data[out + 3] = a / count;
    }
  }

  return { width, height, data };
}

/* ------------------------------------------------------------------ */
/* Ochiq API                                                           */
/* ------------------------------------------------------------------ */

/** Fayl turini imzo bo'yicha aniqlaydi (Telegram `mime_type` ga tayanmasdan). */
export function imageKindOf(bytes: Uint8Array): "jpeg" | "png" | "unknown" {
  if (isJpeg(bytes)) return "jpeg";
  if (hasSignature(bytes, PNG_SIGNATURE)) return "png";
  return "unknown";
}

/**
 * Rasm baytlarini RGBA ko'rinishiga aylantiradi. Qo'llab-quvvatlanmagan formatda
 * xato tashlaydi — bot bu xatoni foydalanuvchiga tushunarli xabar qilib ko'rsatadi.
 */
export function decodeSampleImage(bytes: Uint8Array): SampleImage {
  const kind = imageKindOf(bytes);
  if (kind === "jpeg") return shrinkImage(decodeJpeg(bytes));
  if (kind === "png") return shrinkImage(decodePng(bytes));
  throw new Error("Rasm formati tanishmadi — JPEG yoki PNG kerak (Telegram'da «rasm sifatida» yuboring).");
}
