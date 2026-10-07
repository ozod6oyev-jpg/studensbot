import opentype from "opentype.js";
import type { Contour, FontId, Vec2 } from "./types";

export interface HandwritingFont {
  id: FontId;
  font: opentype.Font;
  upem: number;
  /** Em birligida (baseline = 0, pastga musbat) tekislangan konturlar keshi. */
  cache: Map<string, Contour[] | null>;
  /** Kod nuqtasi shriftda bormi. */
  hasCodePoint: (code: number) => boolean;
}

const fontCache = new Map<FontId, HandwritingFont>();

function flattenPath(path: opentype.Path, upem: number): Contour[] {
  const contours: Contour[] = [];
  let current: Vec2[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;

  const push = (x: number, y: number) => {
    current.push({ x: x / upem, y: y / upem });
  };

  for (const command of path.commands) {
    switch (command.type) {
      case "M":
        if (current.length > 1) contours.push(current);
        current = [];
        cx = command.x;
        cy = command.y;
        sx = cx;
        sy = cy;
        push(cx, cy);
        break;
      case "L":
        cx = command.x;
        cy = command.y;
        push(cx, cy);
        break;
      case "Q": {
        const steps = 8;
        const x1 = command.x1;
        const y1 = command.y1;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          const x = mt * mt * cx + 2 * mt * t * x1 + t * t * command.x;
          const y = mt * mt * cy + 2 * mt * t * y1 + t * t * command.y;
          push(x, y);
        }
        cx = command.x;
        cy = command.y;
        break;
      }
      case "C": {
        const steps = 10;
        const { x1, y1, x2, y2 } = command;
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const mt = 1 - t;
          const x = mt * mt * mt * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * command.x;
          const y = mt * mt * mt * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * command.y;
          push(x, y);
        }
        cx = command.x;
        cy = command.y;
        break;
      }
      case "Z":
        if (current.length > 2) {
          // Konturni yopamiz.
          if (current[0].x !== current[current.length - 1].x || current[0].y !== current[current.length - 1].y) {
            current.push({ ...current[0] });
          }
          contours.push(current);
        }
        current = [];
        cx = sx;
        cy = sy;
        break;
      default:
        break;
    }
  }

  if (current.length > 2) contours.push(current);
  return contours;
}

/** Shrift baytlarini tahlil qiladi (natija keshlanadi). */
export function parseFont(id: FontId, bytes: Uint8Array | ArrayBuffer): HandwritingFont {
  const cached = fontCache.get(id);
  if (cached) return cached;

  const buffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  const font = opentype.parse(buffer);
  const upem = font.unitsPerEm || 1000;

  const handle: HandwritingFont = {
    id,
    font,
    upem,
    cache: new Map(),
    hasCodePoint: (code: number) => {
      try {
        // opentype.js cmap'ni "charToGlyphIndex" orqali ochadi;
        // 0 — .notdef, ya'ni belgi shriftda yo'q.
        return font.charToGlyphIndex(String.fromCodePoint(code)) > 0;
      } catch {
        return false;
      }
    },
  };

  fontCache.set(id, handle);
  return handle;
}

export function getCachedFont(id: FontId): HandwritingFont | undefined {
  return fontCache.get(id);
}

/**
 * Bitta belgi konturlarini em birligida qaytaradi:
 * baseline = 0, y pastga musbat. Topilmasa null.
 */
export function glyphContours(handle: HandwritingFont, ch: string): Contour[] | null {
  const cached = handle.cache.get(ch);
  if (cached !== undefined) return cached;

  const code = ch.codePointAt(0) ?? 0;
  const result = handle.hasCodePoint(code)
    ? (() => {
        const glyph = handle.font.charToGlyph(ch);
        // fontSize = upem → konturlar shrift birliklarida qoladi.
        const path = glyph.getPath(0, 0, handle.upem);
        const contours = flattenPath(path, handle.upem);
        return contours.length > 0 ? contours : null;
      })()
    : null;

  handle.cache.set(ch, result);
  return result;
}

/** Belgi kengligi (em birligida). */
export function glyphAdvance(handle: HandwritingFont, ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (!handle.hasCodePoint(code)) return 0;
  const glyph = handle.font.charToGlyph(ch);
  return (glyph.advanceWidth ?? 0) / handle.upem;
}

/** Kerning qiymati (em birligida). */
export function kern(handle: HandwritingFont, a: string, b: string): number {
  const left = handle.font.charToGlyph(a);
  const right = handle.font.charToGlyph(b);
  if (!left || !right) return 0;
  try {
    return (handle.font.getKerningValue(left, right) ?? 0) / handle.upem;
  } catch {
    return 0;
  }
}

export function fontHas(handle: HandwritingFont, ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return handle.hasCodePoint(code);
}
