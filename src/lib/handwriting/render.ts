import { fontHas, glyphAdvance, glyphContours, parseFont, type HandwritingFont } from "./font";
import { FALLBACK_FONT_ID, fontEntry } from "./fonts.generated";
import { baselineForLine, layoutText } from "./layout";
import { inkHex } from "./options";
import { paintPaper } from "./paper";
import { hasSymbol, strokeToContours, symbolStrokes, thickLine } from "./pen";
import { encodePng } from "./png";
import { InkCanvas } from "./raster";
import { createRng } from "./rng";
import {
  DEFAULT_STYLE,
  type Contour,
  type FontId,
  type InkSink,
  type NotebookStyle,
  type RenderInput,
  type RenderPage,
  type RenderResult,
  type StrokePath,
} from "./types";

interface Group {
  contours: Contour[];
  alpha: number;
}

function parseInk(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function drawFonts(bytes: RenderInput["fonts"]): Partial<Record<FontId, HandwritingFont>> {
  const handles: Partial<Record<FontId, HandwritingFont>> = {};
  if (!bytes) return handles;
  for (const key of Object.keys(bytes) as FontId[]) {
    const data = bytes[key];
    if (!data) continue;
    try {
      handles[key] = parseFont(key, data);
    } catch {
      /* buzilgan shrift fayli — e'tiborsiz qoldiramiz */
    }
  }
  return handles;
}

/** Bitta varaqani chizadi va PNG qaytaradi. */
async function renderPage(
  index: number,
  total: number,
  layout: ReturnType<typeof layoutText>,
  style: NotebookStyle,
  primary: HandwritingFont,
  secondary: HandwritingFont | undefined,
  buffers: {
    canvas: InkCanvas;
    coverage: Float32Array;
    alphaMap: Uint8Array;
    rgba: Uint8ClampedArray;
  },
): Promise<RenderPage> {
  const { canvas, coverage, alphaMap, rgba } = buffers;
  const width = layout.paper.width;
  const height = layout.paper.height;

  // Varaqning tomoni: birinchi varaq `style.startSide` bilan boshlanadi,
  // keyingilari almashadi — haqiqiy daftardagidek. Orqa tomonda qizil chegara
  // o'ng tomonda bo'ladi va matn chap chetdan boshlanadi.
  const verso = style.startSide === "verso" ? index % 2 === 0 : index % 2 === 1;
  const textLeft = verso ? layout.versoTextLeft : layout.textLeft;
  const pagePaper = verso ? { ...layout.paper, marginOnRight: true } : layout.paper;
  const rng = createRng(style.seed * 2654435761 + index * 40503);
  const groups: Group[] = [];
  const lineState = { slope: 0, offset: 0 };
  const jitterAmount = style.wobble * style.fontSize * 0.032;

  // Juda ingichka shriftlar (masalan Amatic SC) daftarda deyarli ko'rinmaydi,
  // shuning uchun ularning shtrixini biroz qalinlashtiramiz (o'lchangan
  // `inkDensity` qiymatiga qarab).
  const inkBoost = (fontEntry(primary.id)?.inkDensity ?? 0.1) < 0.028;

  alphaMap.fill(0);

  const pushContours = (contours: Contour[], alpha: number) => {
    if (contours.length === 0) return;
    groups.push({ contours, alpha: Math.max(0.15, Math.min(1, alpha)) });
  };

  /** Shtrixni chizadi; kerak bo'lsa qalinlashtirish uchun 4 tomonga siljitadi. */
  const pushInk = (contours: Contour[], alpha: number) => {
    pushContours(contours, alpha);
    if (!inkBoost) return;
    const spread = 0.45;
    for (const [dx, dy] of [
      [spread, 0],
      [-spread, 0],
      [0, spread],
      [0, -spread],
    ]) {
      pushContours(
        contours.map((contour) => contour.map((point) => ({ x: point.x + dx, y: point.y + dy }))),
        alpha,
      );
    }
  };

  const sink: InkSink = {
    glyph(ch, x, baseline, size, alpha) {
      const handle = fontHas(primary, ch) ? primary : secondary && fontHas(secondary, ch) ? secondary : undefined;
      const contours = handle ? glyphContours(handle, ch) : null;

      if (!contours || !handle) {
        if (hasSymbol(ch)) {
          sink.symbol(ch, x, baseline, size, alpha);
        }
        return;
      }

      const advance = glyphAdvance(handle, ch) * size;
      const dx = rng.signed() * jitterAmount;
      const dy = rng.signed() * jitterAmount * 0.7 + lineState.slope * (x - textLeft) * 0.35 + lineState.offset;
      const angle = rng.signed() * style.wobble * 0.05;
      const scale = 1 + rng.signed() * style.wobble * 0.025;
      const alphaMod = alpha * (1 - rng.next() * style.wobble * 0.18);

      const anchorX = x + dx + advance / 2;
      const anchorY = baseline + dy - size * 0.3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const transformed: Contour[] = contours.map((contour) =>
        contour.map((point) => {
          const px = x + dx + (point.x * size - advance / 2) * scale;
          const py = baseline + dy + point.y * size * scale;
          const rx = px - anchorX;
          const ry = py - anchorY;
          return {
            x: anchorX + rx * cos - ry * sin,
            y: anchorY + rx * sin + ry * cos,
          };
        }),
      );

      pushInk(transformed, alphaMod);
    },

    symbol(ch, x, baseline, size, alpha) {
      const strokes = symbolStrokes(ch);
      if (strokes.length === 0) return;
      const dx = rng.signed() * jitterAmount * 0.6;
      const dy = rng.signed() * jitterAmount * 0.5 + lineState.slope * (x - textLeft) * 0.35;
      const contours = strokeToContours(strokes, size, x + dx, baseline + dy);
      const alphaMod = alpha * (1 - rng.next() * style.wobble * 0.16);
      for (const contour of contours) pushInk([contour], alphaMod);
    },

    strokes(paths: StrokePath[], x, baseline, size, alpha) {
      for (const contour of strokeToContours(paths, size, x, baseline)) {
        pushContours([contour], alpha);
      }
    },

    line(x1, y1, x2, y2, thickness, alpha) {
      pushContours([thickLine(x1, y1, x2, y2, thickness)], alpha);
    },
  };

  layout.pages[index].lines.forEach((line, lineIndex) => {
    lineState.slope = style.wobble * 0.0016;
    lineState.offset = rng.signed() * style.wobble * 1.6;
    const lineBaseline = baselineForLine(lineIndex, layout);
    for (const placed of line.atoms) {
      placed.atom.render(sink, textLeft + placed.x, lineBaseline, 1);
    }
  });

  // Konturlarni rasterlash (har bir guruh even-odd qoidasi bilan).
  for (const group of groups) {
    canvas.fill(group.contours);
  }

  // Siyoh quvvati (alpha) xaritasini yakuniy o'lchamda yozamiz.
  for (const group of groups) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const contour of group.contours) {
      for (const point of contour) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(width - 1, Math.ceil(maxX));
    const y1 = Math.min(height - 1, Math.ceil(maxY));
    const value = Math.round(group.alpha * 255);
    for (let y = y0; y <= y1; y += 1) {
      const rowOffset = y * width;
      for (let x = x0; x <= x1; x += 1) {
        const at = rowOffset + x;
        if (alphaMap[at] < value) alphaMap[at] = value;
      }
    }
  }

  const coverageBuffer = canvas.resolve(coverage);
  paintPaper(rgba, pagePaper, style);
  const [inkR, inkG, inkB] = parseInk(inkHex(style.ink));

  for (let i = 0, p = 0; i < coverageBuffer.length; i += 1, p += 4) {
    const strength = coverageBuffer[i] * (alphaMap[i] / 255);
    if (strength <= 0.001) continue;
    const inverse = 1 - strength;
    rgba[p] = rgba[p] * inverse + inkR * strength;
    rgba[p + 1] = rgba[p + 1] * inverse + inkG * strength;
    rgba[p + 2] = rgba[p + 2] * inverse + inkB * strength;
  }

  const png = await encodePng(rgba, width, height);
  return {
    index: index + 1,
    total,
    width,
    height,
    png,
    rgba,
    side: verso ? "verso" : "recto",
  };
}

/**
 * Matnni qo'lyozma varaqalarga aylantiradi.
 * Bir xil `seed` va bir xil matn uchun natija har doim bir xil bo'ladi.
 */
export async function renderNotebook(input: RenderInput | string): Promise<RenderResult> {
  const parsed: RenderInput = typeof input === "string" ? { text: input } : input;
  const style: NotebookStyle = { ...DEFAULT_STYLE, ...parsed.style };
  const warnings = new Set<string>();

  const handles = drawFonts(parsed.fonts);
  const preferred = handles[style.font];
  const fallback = handles[FALLBACK_FONT_ID] ?? Object.values(handles)[0];
  const primary = preferred ?? fallback;

  if (!primary) {
    throw new Error(
      "Shrift yuklanmagan: renderNotebook() ga `fonts` orqali qo'lyozma shrift baytlari berilishi kerak.",
    );
  }

  if (!preferred && fallback) {
    warnings.add(`"${style.font}" shrifti topilmadi — ${fallback.id} ishlatildi.`);
  }

  // Zaxira shrift: tanlangan shriftda yetim belgi bo'lsa (masalan kirill),
  // shu shriftdan foydalanamiz.
  const secondary = preferred && fallback && fallback !== preferred ? fallback : undefined;
  const layout = layoutText({
    text: parsed.text,
    style,
    primary,
    secondary,
    sizeScale: fontEntry(primary.id)?.sizeScale ?? 1,
  });
  for (const warning of layout.warnings) warnings.add(warning);

  const buffers = {
    canvas: new InkCanvas(layout.paper.width, layout.paper.height, 3),
    coverage: new Float32Array(layout.paper.width * layout.paper.height),
    alphaMap: new Uint8Array(layout.paper.width * layout.paper.height),
    rgba: new Uint8ClampedArray(layout.paper.width * layout.paper.height * 4),
  };

  const pages: RenderPage[] = [];
  for (let index = 0; index < layout.pages.length; index += 1) {
    pages.push(await renderPage(index, layout.pages.length, layout, style, primary, secondary, buffers));
  }

  return { pages, warnings: Array.from(warnings) };
}
