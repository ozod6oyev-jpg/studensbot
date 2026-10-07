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
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { renderNotebook } from "../src/lib/handwriting/render";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";
import type { NotebookStyle } from "../src/lib/handwriting/types";

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
    }
    if (count > best.count) best = { y, count };
  }
  return best;
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

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  await renderCase("adabiyot-chiziqli", LITERATURE, { paper: "lined", seed: 11 });
  await renderCase("matematika-katak", MATH, { paper: "grid", seed: 21 });
  await renderCase("marck-toza", LITERATURE, { paper: "plain", font: "marck", seed: 31 });

  await verifyMathGeometry();
  await verifyFontLibrary();
  await verifyFallbackFont();
  await verifySizeNormalization();
  await verifyPagination();

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
