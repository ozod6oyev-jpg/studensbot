/**
 * Dvigatelni tekshirish: `bun run check:render`
 *
 *  1. Namuna varaqalarni chizadi (adabiyot, matematika, toza qog'oz) va
 *     PNG'ni ASCII ko'rinishida chiqaradi — natija haqiqatan daftarga
 *     o'xshashini shu yerda ko'rish mumkin.
 *  2. Matematika joylashuvini raqamlar bilan tekshiradi: daraja yuqorida,
 *     pastki indeks pastda, kasr chizig'i surat va maxraj orasida, ildiz
 *     ustki chizig'i ildiz ostidagi ifodadan yuqorida.
 *  3. Uzun matn bir necha varaqqa bo'linishini, kirill va o'zbek tutuq
 *     belgisi ogohlantirishsiz chizilishini tasdiqlaydi.
 *  4. «Qator tashlab yozish» aynan so'ralgan sonda bo'sh qator qoldirishini
 *     (o'ralgan paragrafdan keyin ham) va varaqadagi siyoh modelga mos
 *     kelishini — ya'ni rasmda ham o'sha qatorlar bo'sh turishini tekshiradi.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { renderNotebook } from "../src/lib/handwriting/render";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";
import { parseFont } from "../src/lib/handwriting/font";
import { baselineForLine, layoutText } from "../src/lib/handwriting/layout";
import { appendChunk, measureLineCount, measureSideText } from "../src/lib/handwriting/notebook-text";
import { INK_OPTIONS } from "../src/lib/handwriting/options";
import { DEFAULT_STYLE, type NotebookStyle } from "../src/lib/handwriting/types";

const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);
const OUT_DIR = "/tmp/daftar-check";
/** Siyohni aniqlashda chap qirra soyasini hisobga olmaymiz. */
const INK_MARGIN = 24;
const INK_THRESHOLD = 130;

const LITERATURE = `Vatan haqida

Vatan — bu faqat tuproq emas, u — bolaligim,
onamning ovozi, tonggi shabada.
Ko'ngil qaysi yurtda bo'lmasin, vatan o'sha
yerda boshlanadi.

A. Oripov`;

const MATH = `Mavzu: Kvadrat tenglama

x^2 - 5x + 6 = 0
D = b^2 - 4ac = 25 - 24 = 1

x_1 = \\frac{5 + 1}{2} = 3

x_2 = \\frac{5 - 1}{2} = 2

\\sqrt{16} + \\sqrt[3]{27} = 4 + 3 = 7

Javob: x_1 = 3, x_2 = 2`;

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

/** Kutubxonadan istalgan shriftni diskdan o'qiydi. */
async function loadLibraryFont(id: string): Promise<Uint8Array> {
  const entry = fontEntry(id);
  if (!entry) throw new Error(`"${id}" shrifti manifestda topilmadi`);
  return new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
}

/** Namuna va geometriya tekshiruvlari uchun yetarli shrift to'plami. */
async function loadFonts(): Promise<Record<string, Uint8Array>> {
  const fonts: Record<string, Uint8Array> = {};
  for (const id of [FALLBACK_FONT_ID, "marck"]) {
    const entry = fontEntry(id);
    if (entry) fonts[id] = await loadLibraryFont(id);
  }
  return fonts;
}

/** Kichik namuna varaqasi (`strip`) — galereya plitkalari bilan bir xil sozlama. */
async function renderStrip(fontId: string, text: string): Promise<PNG> {
  const result = await renderNotebook({
    text,
    style: {
      paper: "plain",
      pageFormat: "strip",
      fontSize: 34,
      lineGap: 56,
      marginLine: false,
      marginLeft: 60,
      wobble: 0.5,
      seed: 5,
      mathMode: true,
      font: fontId,
    },
    fonts: { [fontId]: await loadLibraryFont(fontId), [FALLBACK_FONT_ID]: await loadLibraryFont(FALLBACK_FONT_ID) },
  });
  return PNG.sync.read(Buffer.from(result.pages[0].png));
}

function isInk(png: PNG, x: number, y: number): boolean {
  const index = (png.width * y + x) << 2;
  const luminance = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
  return luminance < INK_THRESHOLD;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

function inkBounds(png: PNG, threshold = INK_THRESHOLD): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = INK_MARGIN; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const luminance = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
      if (luminance >= threshold) continue;
      count += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, count };
}

function inkRatio(png: PNG): number {
  let dark = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = INK_MARGIN; x < png.width; x += 1) {
      if (isInk(png, x, y)) dark += 1;
    }
  }
  return dark / (png.width * png.height);
}

/** Ketma-ket siyohli satrlar guruhini (taxminan matn qatorlari) sanaydi. */
function inkLineGroups(png: PNG): number {
  let groups = 0;
  let previous = -100;
  for (let y = 0; y < png.height; y += 1) {
    let hasInk = false;
    for (let x = INK_MARGIN; x < png.width; x += 1) {
      if (isInk(png, x, y)) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) continue;
    if (y - previous > 6) groups += 1;
    previous = y;
  }
  return groups;
}

/** Eng ko'p siyoh bo'lgan satr — kasr chizig'i kabi uzun gorizontal shakllar uchun. */
function widestInkRow(png: PNG): { y: number; count: number } {
  let best = { y: -1, count: 0 };
  for (let y = 0; y < png.height; y += 1) {
    let count = 0;
    for (let x = INK_MARGIN; x < png.width; x += 1) {
      if (isInk(png, x, y)) count += 1;
    }        if (count > best.count) best = { y, count };
  }
  return best;
}

interface MeasuredInk {
  count: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Chizilgan varaqadagi siyohning rangini o'lchaydi. Eng quyuq piksellar
 * siyohning "toza" rangiga eng yaqin bo'ladi (qog'oz rangi aralashmasi kam).
 */
function measureInk(png: PNG, threshold = 150): MeasuredInk {
  const pixels: { r: number; g: number; b: number; lum: number }[] = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = INK_MARGIN; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const r = png.data[index];
      const g = png.data[index + 1];
      const b = png.data[index + 2];
      const lum = (r + g + b) / 3;
      if (lum < threshold) pixels.push({ r, g, b, lum });
    }
  }
  if (pixels.length === 0) return { count: 0, r: 0, g: 0, b: 0 };

  pixels.sort((a, b) => a.lum - b.lum);
  const sample = pixels.slice(0, Math.max(20, Math.round(pixels.length * 0.05)));
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of sample) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  return { count: pixels.length, r: r / sample.length, g: g / sample.length, b: b / sample.length };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** O'lchangan siyoh rangiga eng yaqin inkni topadi. */
function nearestInk(measured: MeasuredInk) {
  let best = INK_OPTIONS[0];
  let bestDistance = Infinity;
  for (const option of INK_OPTIONS) {
    const [r, g, b] = hexToRgb(option.hex);
    const distance = (r - measured.r) ** 2 + (g - measured.g) ** 2 + (b - measured.b) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

/**
 * Qizil chegara chizig'ining x koordinatasi. Varaqaning yarmidan ko'prog'ida
 * qizil (r > g va r > b) piksellar bo'lgan ustunni qidiradi; topilmasa -1.
 */
function marginColumn(png: PNG): number {
  let bestX = -1;
  let bestCount = 0;
  for (let x = 0; x < png.width; x += 1) {
    let count = 0;
    for (let y = 0; y < png.height; y += 1) {
      const index = (png.width * y + x) << 2;
      const r = png.data[index];
      const g = png.data[index + 1];
      const b = png.data[index + 2];
      if (r - g > 30 && r - b > 20) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      bestX = x;
    }
  }
  return bestCount > png.height * 0.5 ? bestX : -1;
}

function asciiPreview(png: PNG, columns: number, rows: number): string {
  const shades = " .:-=+*#%@";
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor((column * png.width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((column + 1) * png.width) / columns));
      const y0 = Math.floor((row * png.height) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * png.height) / rows));
      // Eng to'q piksel: yupqa qalam chizig'i yirik blokda yo'qolmasligi uchun.
      let darkest = 255;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const index = (png.width * y + x) << 2;
          const luminance = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
          if (luminance < darkest) darkest = luminance;
        }
      }
      const darkness = Math.max(0, Math.min(1, (225 - darkest) / 150));
      line += shades[Math.min(shades.length - 1, Math.round(darkness * (shades.length - 1)))];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

async function renderCase(label: string, text: string, style: Partial<NotebookStyle>): Promise<void> {
  const started = performance.now();
  const result = await renderNotebook({ text, style, fonts: await loadFonts() });
  const elapsed = Math.round(performance.now() - started);

  console.log(`\n=== ${label} ===`);
  console.log(`varaq: ${result.pages.length}, vaqt: ${elapsed} ms`);
  if (result.warnings.length > 0) console.log(`ogohlantirish: ${result.warnings.join(" | ")}`);

  for (const page of result.pages) {
    const png = PNG.sync.read(Buffer.from(page.png));
    const file = `${OUT_DIR}/${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${page.index}.png`;
    await writeFile(file, Buffer.from(page.png));
    console.log(
      `  ${page.index}/${page.total}: ${page.width}x${page.height}, ${Math.round(
        page.png.byteLength / 1024,
      )} KB, siyoh ${(inkRatio(png) * 100).toFixed(2)}%, matn qatorlari ≈ ${inkLineGroups(png)}, fayl: ${file}`,
    );
    console.log(asciiPreview(png, 108, 40));
  }
}

/** Matematika joylashuvi geometriyasini tekshiradi. */
async function verifyMathGeometry(): Promise<void> {
  const size = 48;
  const style: Partial<NotebookStyle> = {
    paper: "plain",
    fontSize: size,
    lineGap: 100,
    wobble: 0,
    seed: 1,
    mathMode: true,
    marginLine: false,
  };

  const render = async (text: string) => {
    const result = await renderNotebook({ text, style, fonts: await loadFonts() });
    return { png: PNG.sync.read(Buffer.from(result.pages[0].png)), warnings: result.warnings };
  };

  console.log("\n=== matematika geometriyasi ===");

  const plainX = await render("x");
  const plainA = await render("a");
  const xBounds = inkBounds(plainX.png);
  const aBounds = inkBounds(plainA.png);
  const baseline = xBounds.maxY;
  assert(plainX.warnings.length === 0, `"x" ogohlantirishsiz chizildi (baseline = ${baseline})`);
  assert(xBounds.maxY <= baseline + 2, 'oddiy "x" asosiy chiziqdan pastga tushmaydi');

  const superscript = await render("a^2");
  const supBounds = inkBounds(superscript.png);
  assert(superscript.warnings.length === 0, "daraja (a^2) ogohlantirishsiz o'qildi");
  assert(
    supBounds.minY < aBounds.minY - 0.15 * size,
    `daraja yuqoriga ko'tarilgan (a^2 min y = ${supBounds.minY}, "a" min y = ${aBounds.minY})`,
  );
  assert(supBounds.maxY < baseline + 6, "daraja asosiy chiziqdan pastga tushmaydi");

  const subscript = await render("x_1");
  const subBounds = inkBounds(subscript.png);
  assert(subscript.warnings.length === 0, "pastki indeks (x_1) ogohlantirishsiz o'qildi");
  assert(
    subBounds.maxY > baseline + 0.04 * size,
    `pastki indeks pastga tushgan (x_1 max y = ${subBounds.maxY}, baseline = ${baseline})`,
  );
  assert(subBounds.maxY < baseline + 0.6 * size, "pastki indeks juda pastga ketmagan");

  const braced = await render("a^{10}");
  const literalBraces = await render("a{10}");
  assert(braced.warnings.length === 0, "jingalak qavsli daraja (a^{10}) ogohlantirishsiz o'qildi");
  assert(
    inkBounds(braced.png).minY < aBounds.minY - 0.15 * size,
    `a^{10} darajasi yuqoriga ko'tarilgan (min y = ${inkBounds(braced.png).minY})`,
  );
  // Qavslar tuzilma sifatida o'qilsa, ular chizilmaydi: siyoh kamroq bo'ladi.
  assert(
    inkBounds(braced.png).count < inkBounds(literalBraces.png).count,
    `a^{10} dagi qavslar chizilmadi (siyoh: ${inkBounds(braced.png).count} < ${inkBounds(literalBraces.png).count})`,
  );

  const inlineFraction = await render("$a/b$");
  const inlineBar = widestInkRow(inlineFraction.png);
  const inlineBounds = inkBounds(inlineFraction.png);
  assert(inlineFraction.warnings.length === 0, "$a/b$ ogohlantirishsiz o'qildi");
  assert(
    inlineBar.count > 20,
    `$a/b$ kasr chizig'i chizildi (eng uzun siyoh satri ${inlineBar.count} px)`,
  );
  assert(
    inlineBounds.minY < inlineBar.y - 4 && inlineBounds.maxY > inlineBar.y + 4,
    "$a/b$ da surat chizig'idan yuqorida, maxraj pastda",
  );

  const fraction = await render("\\frac{5 + 1}{2}");
  const fractionBounds = inkBounds(fraction.png);
  const bar = widestInkRow(fraction.png);
  assert(fraction.warnings.length === 0, "kasr ogohlantirishsiz chizildi");
  assert(
    bar.y < baseline - 0.1 * size && bar.y > baseline - 0.55 * size,
    `kasr chizig'i o'rta chiziq atrofida (y = ${bar.y}, baseline = ${baseline})`,
  );
  assert(
    fractionBounds.minY < bar.y - 6 && fractionBounds.maxY > bar.y + 6,
    "surat chizig'idan yuqorida, maxraj pastda joylashgan",
  );

  const digits = await render("16");
  const radical = await render("\\sqrt{16}");
  const radicalBounds = inkBounds(radical.png);
  assert(radical.warnings.length === 0, "ildiz ogohlantirishsiz chizildi");
  assert(
    radicalBounds.minY < inkBounds(digits.png).minY - 0.1 * size,
    `ildiz ustki chizig'i ifodadan yuqorida (ustki chiziq y = ${radicalBounds.minY}, raqamlar y = ${
      inkBounds(digits.png).minY
    })`,
  );
  assert(
    radicalBounds.maxX - radicalBounds.minX > 0.9 * size,
    "ildiz belgisi va ostidagi ifoda birgalikda chizilgan",
  );

  const plainRadical = await render("\\sqrt{27}");
  const indexRadical = await render("\\sqrt[3]{27}");
  assert(
    indexRadical.warnings.length === 0,
    "ildiz darajasi (\\sqrt[3]{27}) ogohlantirishsiz o'qildi",
  );
  assert(
    inkBounds(indexRadical.png).count > inkBounds(plainRadical.png).count + 20,
    "\\sqrt[3]{27} indeksi qo'shimcha siyoh qo'shdi",
  );

  const greek = await render("√2 ± ∞ ∑ α λ π ° ∠");
  assert(greek.warnings.length === 0, "matematik belgilar ogohlantirishsiz chizildi");

  const cyrillic = await render("Salom, o\u02bbzbek tili! Привет, 28 °C");
  assert(cyrillic.warnings.length === 0, `kirill va o'zbek tutuq belgisi chizildi (${cyrillic.warnings.join(" | ")})`);
}

/**
 * Kutubxonadagi HAR BIR shriftni alohida tekshiradi:
 * fayl o'qiladi, sahifa chiziladi va siyoh paydo bo'ladi.
 */
async function verifyFontLibrary(): Promise<void> {
  console.log(`\n=== shriftlar kutubxonasi (${FONT_LIBRARY.length} shrift) ===`);
  const fallbackBytes = await loadLibraryFont(FALLBACK_FONT_ID);

  let empty = 0;
  let failed = 0;
  const byCategory = new Map<string, number>();

  for (const entry of FONT_LIBRARY) {
    const sample = entry.cyrillic ? "Salom, daftar! Абв 123 x^2" : "Salom, daftar! Abc 123 x^2";
    try {
      const result = await renderNotebook({
        text: sample,
        style: {
          paper: "plain",
          pageFormat: "strip",
          fontSize: 34,
          lineGap: 56,
          marginLine: false,
          marginLeft: 60,
          wobble: 0.5,
          seed: 5,
          mathMode: true,
          font: entry.id,
        },
        fonts: { [entry.id]: await loadLibraryFont(entry.id), [FALLBACK_FONT_ID]: fallbackBytes },
      });
      const png = PNG.sync.read(Buffer.from(result.pages[0].png));
      // Ingichka shriftlar shtrixi ochroq bo'ladi, shuning uchun "chizilganmi"
      // savoliga sezgir chegara bilan javob beramiz (qog'oz ~247).
      const bounds = inkBounds(png, 205);
      byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
      if (bounds.count < 400) {
        empty += 1;
        console.log(`  ✗ ${entry.id}: siyoh juda kam (${bounds.count} px)`);
      } else if (result.warnings.length > 0) {
        console.log(`  ✓ ${entry.id.padEnd(20)} ${entry.family.padEnd(22)} (ogohlantirish: ${result.warnings.join(" ")})`);
      } else {
        console.log(`  ✓ ${entry.id.padEnd(20)} ${entry.family.padEnd(22)} siyoh ${bounds.count} px`);
      }
    } catch (error) {
      failed += 1;
      console.log(`  ✗ ${entry.id}: ${(error as Error).message}`);
    }
  }

  assert(empty === 0, `barcha shriftlar siyoh chizdi (bo'sh: ${empty})`);
  assert(failed === 0, `barcha shrift fayllari o'qildi (xato: ${failed})`);
  console.log(
    `  kategoriyalar: ${Array.from(byCategory.entries())
      .map(([category, count]) => `${category} ${count}`)
      .join(", ")}`,
  );
}

/** Kirillchani bilmaydigan shriftda zaxira shrift ishlashini tekshiradi. */
async function verifyFallbackFont(): Promise<void> {
  const entry = FONT_LIBRARY.find((item) => !item.cyrillic);
  if (!entry) return;
  console.log("\n=== zaxira shrift ===");
  const result = await renderNotebook({
    text: "Привет, 2026 x^2",
    style: { paper: "plain", pageFormat: "strip", fontSize: 34, lineGap: 56, marginLine: false, font: entry.id },
    fonts: { [entry.id]: await loadLibraryFont(entry.id), [FALLBACK_FONT_ID]: await loadLibraryFont(FALLBACK_FONT_ID) },
  });
  const png = PNG.sync.read(Buffer.from(result.pages[0].png));
  const bounds = inkBounds(png, 205);
  assert(bounds.count > 300, `${entry.id} (kirillsiz) va zaxira shrift birga chizdi (${bounds.count} px)`);
}

/** Shriftlar orasida o'lcham tenglashtirilganini o'lchaydi (sizeScale). */
async function verifySizeNormalization(): Promise<void> {
  console.log("\n=== o'lcham tenglashtirish ===");
  const heights: { id: string; height: number }[] = [];

  for (const entry of FONT_LIBRARY) {
    const png = await renderStrip(entry.id, "x");
    const bounds = inkBounds(png, 205);
    heights.push({ id: entry.id, height: bounds.count > 0 ? bounds.maxY - bounds.minY : 0 });
  }

  const reference = heights.find((item) => item.id === FALLBACK_FONT_ID)?.height ?? 0;
  assert(reference > 5, `etalon "x" balandligi o'lchandi (${reference} px)`);

  const worst = heights
    .map((item) => ({ ...item, ratio: reference > 0 ? item.height / reference : 0 }))
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))[0];
  const outliers = heights.filter((item) => reference > 0 && (item.height / reference < 0.55 || item.height / reference > 1.8));

  assert(
    outliers.length === 0,
    `barcha shriftlarda "x" balandligi bir tekis (eng chetki: ${worst.id}, nisbat ${worst.ratio.toFixed(2)}, chegaradan chiqqan: ${outliers.length})`,
  );
}

/** 10 xil siyoh rangi haqiqatan ajralib turishini o'lchaydi. */
async function verifyInkColors(): Promise<void> {
  console.log("\n=== siyoh ranglari ===");
  const fonts = await loadFonts();
  assert(INK_OPTIONS.length === 10, `kutubxonada ${INK_OPTIONS.length} xil siyoh rangi (maksimum 10 ta)`);

  const recognized = new Set<string>();
  for (const option of INK_OPTIONS) {
    const result = await renderNotebook({
      text: LITERATURE,
      style: { paper: "plain", ink: option.id, marginLine: false, seed: 11, fontSize: 40, lineGap: 64 },
      fonts,
    });
    const png = PNG.sync.read(Buffer.from(result.pages[0].png));
    const measured = measureInk(png);
    const nearest = nearestInk(measured);
    if (nearest.id === option.id) recognized.add(option.id);
    assert(
      measured.count > 300 && nearest.id === option.id,
      `${option.id.padEnd(9)} ${option.label.padEnd(12)} siyoh ${String(measured.count).padStart(
        5,
      )} px, o'lchangan rang: ${nearest.id}`,
    );
  }
  assert(
    recognized.size === INK_OPTIONS.length,
    `barcha ${INK_OPTIONS.length} siyoh rangi alohida tanildi (${recognized.size})`,
  );
}

/**
 * Daftar kabi: keyingi varaqning qizil chegarasi o'ng tomonda bo'lishini va
 * matn shu tomonga moslashishini tekshiradi.
 */
async function verifyPageSides(): Promise<void> {
  console.log("\n=== varaq tomonlari (qizil chegara) ===");
  const fonts = await loadFonts();
  const long = Array.from({ length: 60 }, (_, index) => `Qator ${index + 1}: Salom, daftar!`).join("\n");
  const style: Partial<NotebookStyle> = { paper: "lined", fontSize: 40, lineGap: 60, seed: 7 };

  const front = await renderNotebook({ text: long, style, fonts });
  assert(front.pages.length >= 3, `uzun matn ${front.pages.length} varaqqa bo'lindi`);

  const frontPngs = front.pages.map((page) => PNG.sync.read(Buffer.from(page.png)));
  const columns = frontPngs.map((png) => marginColumn(png));
  const bounds = frontPngs.map((png) => inkBounds(png));

  front.pages.forEach((page, index) => {
    const expected = index % 2 === 0 ? "recto" : "verso";
    assert(page.side === expected, `${page.index}-varaq tomoni: ${page.side} (kutilgan ${expected})`);
  });
  assert(columns[0] > 0 && columns[0] < front.pages[0].width / 2, `1-varaqda chegara chapda (x = ${columns[0]})`);
  assert(columns[1] > front.pages[1].width / 2, `2-varaqda chegara o'ngda (x = ${columns[1]})`);
  assert(
    bounds[0].minX > columns[0] && bounds[1].minX < columns[1],
    `matn chegaraga mos: 1-varaqda chegaradan o'ngda (${bounds[0].minX} > ${columns[0]}), 2-varaqda chapda (${bounds[1].minX} < ${columns[1]})`,
  );

  // Orqa tomondan boshlansa, tomonlar teskari bo'ladi.
  const back = await renderNotebook({ text: long, style: { ...style, startSide: "verso" }, fonts });
  assert(back.pages[0].side === "verso", `startSide: "verso" bilan birinchi varaq orqa tomon (${back.pages[0].side})`);
  const backColumns = back.pages.map((page) => marginColumn(PNG.sync.read(Buffer.from(page.png))));
  assert(
    backColumns[0] > back.pages[0].width / 2,
    `"verso" boshlanishda 1-varaqda chegara o'ngda (x = ${backColumns[0]})`,
  );
  assert(
    backColumns[1] > 0 && backColumns[1] < back.pages[1].width / 2,
    `keyingi varaqda chegara chapda (x = ${backColumns[1]})`,
  );
}

async function verifyPagination(): Promise<void> {
  const long = Array.from({ length: 80 }, (_, index) => `Mashq ${index + 1}: x^2 + ${index} = 0`).join("\n");
  const result = await renderNotebook({ text: long, style: { seed: 41 }, fonts: await loadFonts() });
  console.log("\n=== sahifalash ===");
  assert(result.pages.length > 1, `uzun matn ${result.pages.length} varaqqa bo'lindi`);
  for (const page of result.pages) {
    const png = PNG.sync.read(Buffer.from(page.png));
    assert(inkRatio(png) > 0.002, `${page.index}-varaqda siyoh bor (${(inkRatio(png) * 100).toFixed(2)}%)`);
  }
}

/**
 * «Nechta qator tashlab ketamiz?» savoli aynan shu sonda bo'sh qator
 * qoldirishini tekshiradi.
 *
 * Xato shu yerda edi: bot chizilgan varaqadagi qatorlarni sanab, foydalanuvchiga
 * «M-qatordan boshlanadi» deb aytardi, ammo yozishda matn uzilishlari (paragraf)
 * sonidan foydalanardi. Uzun paragraf bir necha qatorga o'ralgani uchun ular
 * orasidagi farq qancha o'ralsa, shuncha ortiqcha qator tashlab yuborardi
 * (masalan «⏭ 1» — 3 qator bo'sh qolardi).
 */
async function verifySkipLines(): Promise<void> {
  console.log("\n=== qator tashlab yozish (yozuv joyi) ===");
  const entry = fontEntry(FALLBACK_FONT_ID);
  if (!entry) throw new Error(`"${FALLBACK_FONT_ID}" shrifti manifestda topilmadi`);
  const primary = parseFont(FALLBACK_FONT_ID, await loadLibraryFont(FALLBACK_FONT_ID));
  const sizeScale = entry.sizeScale ?? 1;
  // Toza qog'oz: varaqadagi chiziqlar siyoh sanog'iga xalaqit bermasin. Qator
  // geometriyasi (lineGap, birinchi baseline) chiziqli qog'oz bilan bir xil.
  const style: NotebookStyle = {
    ...DEFAULT_STYLE,
    paper: "plain",
    marginLine: false,
    fontSize: 34,
    lineGap: 56,
    seed: 5,
  };
  const fonts = await loadFonts();
  const measure = (text: string) => measureSideText({ text, style, primary, sizeScale });

  // O'ralgan paragraf — xato aynan shunday matnda ko'rinardi.
  const base =
    "qo'llab-quvvatlash guruhimizga yana murojaat qiling va biz buni siz bilan bosqichma-bosqich ko'rib chiqamiz.";
  const baseLines = measure(base).lines.length;
  assert(baseLines >= 2, `namuna paragraf ${baseLines} qatorga o'raladi (o'ralgan holat sinaladi)`);

  const chunk = "Ikkinchi yozuv shu yerdan boshlanadi.";
  const chunkWord = "Ikkinchi";

  for (const skip of [0, 1, 2]) {
    // Bot aynan shunday hisoblaydi: davom etiladigan qator + tashlanadigan son.
    const line = baseLines + 1 + skip;
    const result = appendChunk(base, chunk, line, baseLines);
    const measured = measure(result);
    const startIndex = measured.lines.findIndex((l) => l.words.includes(chunkWord)) + 1;
    assert(
      startIndex === line,
      `⏭ ${skip}: yangi yozuv ${line}-qatordan boshlandi (topilgan: ${startIndex})`,
    );
    const blank = startIndex - baseLines - 1;
    assert(blank === skip, `⏭ ${skip}: oradagi bo'sh qator ${blank} ta (kutilgan: ${skip})`);

    // Rasmda ham xuddi shunday bo'lishi kerak: siyoh faqat matnli qatorda.
    const rendered = await renderNotebook({ text: result, style, fonts });
    const png = PNG.sync.read(Buffer.from(rendered.pages[0].png));
    const layout = layoutText({ text: result, style, primary, sizeScale });
    const band = Math.round(layout.paper.lineGap * 0.35);
    const inked: number[] = [];
    const emptyInked: number[] = [];
    const wordEmpty: number[] = [];

    layout.lines.forEach((layoutLine, index) => {
      const baseline = baselineForLine(index, layout);
      const from = Math.max(0, baseline - band);
      const to = Math.min(png.height - 1, baseline + band);
      let hasInk = false;
      for (let y = from; y <= to && !hasInk; y += 1) {
        for (let x = layout.textLeft; x < png.width; x += 1) {
          if (isInk(png, x, y)) {
            hasInk = true;
            break;
          }
        }
      }
      const number = index + 1;
      // `layoutText` qatoridagi `words` — so'zlar soni (massiv emas).
      if (layoutLine.words === 0) {
        if (hasInk) emptyInked.push(number);
        return;
      }
      if (hasInk) inked.push(number);
      else wordEmpty.push(number);
    });

    assert(
      wordEmpty.length === 0,
      `⏭ ${skip}: matnli qatorlarda siyoh bor (${inked.length} qator${
        wordEmpty.length > 0 ? `, siyohsiz: ${wordEmpty.join(", ")}` : ""
      })`,
    );
    assert(
      emptyInked.length === 0,
      `⏭ ${skip}: bo'sh qatorlarda siyoh yo'q${emptyInked.length > 0 ? ` (siyohli: ${emptyInked.join(", ")})` : ""}`,
    );
  }

  // «⬇️ Yozuvning tagidan»: bo'sh qator qoldirmasdan, oxirgi qatorning tagida.
  const under = appendChunk(base, chunk, baseLines + 1, baseLines);
  const underStart = measure(under).lines.findIndex((l) => l.words.includes(chunkWord)) + 1;
  assert(
    underStart === baseLines + 1,
    `«yozuvning tagidan» ${baseLines + 1}-qatorda (modelda ${measureLineCount(under)} qator)`,
  );
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  await renderCase("adabiyot-chiziqli", LITERATURE, { paper: "lined", seed: 11 });
  await renderCase("matematika-katak", MATH, { paper: "grid", seed: 21 });
  await renderCase("marck-toza", LITERATURE, { paper: "plain", font: "marck", seed: 31 });

  await verifyMathGeometry();
  await verifyFontLibrary();
  await verifyFallbackFont();
  await verifySizeNormalization();
  await verifyInkColors();
  await verifyPageSides();
  await verifyPagination();
  await verifySkipLines();

  console.log(`\nNatijalar: ${OUT_DIR}`);
  if (failures > 0) {
    console.error(`TEKSHIRUV YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("Barcha tekshiruvlar o'tdi.");
}

main().catch((error) => {
  console.error("TEKSHIRUV YIQILDI:", error);
  process.exit(1);
});
