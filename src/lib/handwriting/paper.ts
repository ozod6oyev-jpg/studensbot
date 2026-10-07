import type { Contour, NotebookStyle, Vec2 } from "./types";

export interface PaperLayout {
  width: number;
  height: number;
  /** Birinchi chiziq (rule) ning y koordinatasi. */
  ruleTop: number;
  /** Chiziqlar orasidagi masofa. */
  lineGap: number;
  /** Chap chegara (qizil chiziq) x koordinatasi. */
  marginLeft: number;
  /**
   * Qizil chegara va muqova soyasi o'ng tomonda bo'lsinmi — daftarning orqa
   * tomoni (verso) uchun `true`. Unda chegara `width - 1 - marginLeft` da
   * chiziladi.
   */
  marginOnRight?: boolean;
  marginLine: boolean;
}

const PAPER_BASE = [251, 247, 238];
const RULE_RGB = [152, 170, 200];
const GRID_RGB = [156, 180, 204];
const MARGIN_RGB = [214, 85, 106];

/** Arzon "shovqin" — qog'oz tolasini taqlid qiladi. */
function noise(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) % 1000;
}

/**
 * Qog'oz tolasining donadorligi. Donalar 4x4 bloklarga birlashtirilgan —
 * ko'zga tabiiy ko'rinadi, PNG esa ancha yaxshi siqiladi.
 */
function grain(x: number, y: number): number {
  const coarse = (noise(x >> 2, y >> 2) - 500) / 500;
  const fine = (noise(x + 7919, y + 104729) - 500) / 500;
  return coarse * 0.72 + fine * 0.28;
}

function blend(out: Uint8ClampedArray, index: number, rgb: number[], alpha: number) {
  const inv = 1 - alpha;
  out[index] = out[index] * inv + rgb[0] * alpha;
  out[index + 1] = out[index + 1] * inv + rgb[1] * alpha;
  out[index + 2] = out[index + 2] * inv + rgb[2] * alpha;
}

/** Katak daftar uchun hujayra o'lchami. */
export function gridCell(style: NotebookStyle): number {
  return Math.max(18, Math.round(style.fontSize * 0.88));
}

/**
 * Varaqani chizadi: qog'oz rangi, chiziqlar/kataklar, chegara va qirra soyasi.
 * Natija `out` RGBA massiviga yoziladi (alpha = 255).
 */
export function paintPaper(out: Uint8ClampedArray, layout: PaperLayout, style: NotebookStyle): void {
  const { width, height } = layout;
  const cell = gridCell(style);
  const spineWidth = Math.round(width * 0.022);
  // Orqa tomon (verso) uchun chegara va muqova soyasi oynaga aks etadi.
  const mirrored = layout.marginOnRight === true;
  const marginX = mirrored ? width - 1 - layout.marginLeft : layout.marginLeft;

  for (let y = 0; y < height; y += 1) {
    // Qog'oz rangi: mayin tebranish + chetlarda sal to'qlik (yorug'lik ta'siri).
    const edgeY = Math.min(y, height - 1 - y) / (height * 0.5);
    const shade = 1 - Math.min(1, edgeY * 1.6) * 0.035;

    const gridRow = style.paper === "grid" && y % cell === 0;
    const ruleDistance = style.paper === "lined" ? lineRuleDistance(y, layout) : 2;

    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const fiber = 1 + grain(x, y) * 0.01;

      // Varaqaning muqova tomonidagi mayin soyali qirra (verso varaqada — o'ngda).
      const spineDistance = mirrored ? width - 1 - x : x;
      const spine = spineDistance < spineWidth ? Math.pow(1 - spineDistance / spineWidth, 1.8) : 0;
      const edgeX = Math.min(x, width - 1 - x) / (width * 0.5);
      const vignette = 1 - Math.min(1, edgeX * 1.8) * 0.03 - spine * 0.03;

      let r = PAPER_BASE[0] * shade * fiber * vignette;
      let g = PAPER_BASE[1] * shade * fiber * vignette;
      let b = PAPER_BASE[2] * shade * fiber * vignette;

      if (ruleDistance < 1) {
        const strength = Math.min(1, (1 - ruleDistance) * 0.6) * 0.72;
        r = r * (1 - strength) + RULE_RGB[0] * strength;
        g = g * (1 - strength) + RULE_RGB[1] * strength;
        b = b * (1 - strength) + RULE_RGB[2] * strength;
      }

      if (gridRow || (style.paper === "grid" && x % cell === 0)) {
        const strength = 0.42;
        r = r * (1 - strength) + GRID_RGB[0] * strength;
        g = g * (1 - strength) + GRID_RGB[1] * strength;
        b = b * (1 - strength) + GRID_RGB[2] * strength;
      }

      if (layout.marginLine && Math.abs(x - marginX) < 1.2) {
        const strength = 0.62 * (1 - Math.abs(x - marginX) / 1.2);
        r = r * (1 - strength) + MARGIN_RGB[0] * strength;
        g = g * (1 - strength) + MARGIN_RGB[1] * strength;
        b = b * (1 - strength) + MARGIN_RGB[2] * strength;
      }

      out[index] = r;
      out[index + 1] = g;
      out[index + 2] = b;
      out[index + 3] = 255;
    }
  }

  // Muqova tomonidagi qirra soyasi — yumshoq, kuchli emas.
  // Verso varaqada u o'ng tomonda bo'ladi (x koordinatasi oynaga aks etadi).
  const spineEdge = Math.round(width * 0.016);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < spineEdge; x += 1) {
      const targetX = mirrored ? width - 1 - x : x;
      const index = (y * width + targetX) * 4;
      const strength = 0.34 * Math.pow(1 - x / spineEdge, 2.2);
      blend(out, index, [120, 106, 84], strength);
    }
  }
}

/** Berilgan y chizig'iga eng yaqin rule masofasi (0 = chiziq ustida). */
function lineRuleDistance(y: number, layout: PaperLayout): number {
  const relative = (y - layout.ruleTop) % layout.lineGap;
  const distance = Math.min(Math.abs(relative), Math.abs(relative - layout.lineGap));
  return distance - 0.9;
}

/** Test/tekshirish uchun: varaqadagi konturlarni to'g'ri chizilganini bildiradi. */
export function paperSanity(layout: PaperLayout): { rules: number; contours: Contour[] } {
  const rules = Math.max(0, Math.floor((layout.height - layout.ruleTop) / layout.lineGap));
  const contour: Vec2[] = [
    { x: 0, y: 0 },
    { x: layout.width, y: 0 },
    { x: layout.width, y: layout.height },
    { x: 0, y: layout.height },
  ];
  return { rules, contours: [contour] };
}
