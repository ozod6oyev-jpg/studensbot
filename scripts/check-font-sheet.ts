/**
 * Shrift varaqasi rasmini tekshiradi: `bun run check:sheet`
 *
 * Tekshiriladi:
 *  1. rasm haqiqiy PNG va o'lchamlari e'lon qilingan qiymatlarga mos;
 *  2. har bir so'ralgan shrift o'z qatorida chizilgan (siyoh bor);
 *  3. varaqa ingichka (Telegram uchun ixcham);
 *  4. fayli bo'lmagan shriftlar rasmga ham, `fonts` ro'yxatiga ham kirmaydi;
 *  5. `rowOf()` 1 dan boshlab, uzluksiz raqam qaytaradi.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { renderFontSheet } from "../src/lib/handwriting/font-sheet";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";

const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);
const OUT_DIR = "/tmp/daftar-check";
/** Qog'oz ~247 yorug'likda; siyoh/quyuqroq piksel shundan ancha to'q. */
const INK_THRESHOLD = 205;
/**
 * Nechta bo'sh qatordan keyin yangi qator boshlanadi. Varaqada qatorlar orasi
 * 3 px ajratgich bilan bo'linadi (ajratgich rangi siyoh chegarasidan yorug'),
 * shuning uchun 4 va undan ko'p bo'sh qator — haqiqiy yangi qator.
 */
const ROW_GAP_ROWS = 4;

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

function pngSignature(png: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return signature.every((byte, index) => png[index] === byte);
}

/** Asosiy fayldan shrift o'qish. */
async function loadFont(id: string): Promise<Uint8Array> {
  const entry = fontEntry(id);
  if (!entry) throw new Error(`"${id}" shrifti manifestda topilmadi`);
  return new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
}

/** Siyohli satrlar guruhini (taxminan qatorlarni) sanaydi. */
function inkRowGroups(png: PNG, threshold = INK_THRESHOLD): number {
  let groups = 0;
  let previous = -100;
  for (let y = 0; y < png.height; y += 1) {
    let hasInk = false;
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const luminance = (png.data[index] + png.data[index + 1] + png.data[index + 2]) / 3;
      if (luminance < threshold) {
        hasInk = true;
        break;
      }
    }
    if (!hasInk) continue;
    if (y - previous >= ROW_GAP_ROWS) groups += 1;
    previous = y;
  }
  return groups;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const ids = FONT_LIBRARY.slice(0, 8).map((entry) => entry.id);
  const fonts: Record<string, Uint8Array> = {};
  for (const id of ids) fonts[id] = await loadFont(id);
  fonts[FALLBACK_FONT_ID] = await loadFont(FALLBACK_FONT_ID);

  console.log(`=== shrift varaqasi (${ids.length} shrift) ===`);
  const started = performance.now();
  const sheet = await renderFontSheet(ids, fonts, {
    rowsPerSheet: 8,
    title: `Shriftlar 1/${Math.max(1, Math.ceil(FONT_LIBRARY.length / 8))}`,
    ink: "blue",
  });
  const elapsed = Math.round(performance.now() - started);

  const png = PNG.sync.read(Buffer.from(sheet.png));
  console.log(
    `  rasm: ${sheet.width}x${sheet.height}, ${Math.round(sheet.png.byteLength / 1024)} KB, ${elapsed} ms`,
  );
  const file = `${OUT_DIR}/shrift-varaqasi.png`;
  await writeFile(file, Buffer.from(sheet.png));
  console.log(`  fayl: ${file}`);

  assert(pngSignature(sheet.png), "natija haqiqiy PNG (imzo to'g'ri)");
  assert(
    png.width === sheet.width && png.height === sheet.height,
    `e'lon qilingan o'lcham PNG bilan mos (${sheet.width}x${sheet.height})`,
  );
  assert(sheet.width > 400, `rasm yetarlicha keng (${sheet.width} px)`);
  assert(sheet.height < 900, `rasm ingichka (${sheet.height} px < 900)`);
  assert(
    sheet.fonts.length === ids.length,
    `barcha so'ralgan shriftlar rasmda (${sheet.fonts.length}/${ids.length})`,
  );

  const marker = ids[0];
  const last = ids[ids.length - 1];
  assert(sheet.rowOf(marker) === 1, `rowOf(${marker}) = 1 (1 dan boshlanadi)`);
  assert(sheet.rowOf(last) === ids.length, `rowOf(${last}) = ${ids.length} (oxirgi qator)`);
  assert(sheet.rowOf("bunday-shrift-yoq") === 0, "noma'lum shrift uchun rowOf() = 0");

  // Sarlavha qatori + har bir shrift uchun alohida siyohli tasma bo'lishi kerak.
  const expectedBands = ids.length + 1;
  const rows = inkRowGroups(png);
  assert(
    rows >= expectedBands,
    `har bir shrift qatorida va sarlavhada siyoh bor (siyohli tasmalar: ${rows} ≥ ${expectedBands})`,
  );

  // Fayli bo'lmagan shriftlar tashlab ketilishi: faqat bittasining baytlari beriladi.
  const partial = await renderFontSheet(
    ids,
    { [ids[0]]: fonts[ids[0]], [FALLBACK_FONT_ID]: fonts[FALLBACK_FONT_ID] },
    { rowsPerSheet: 8 },
  );
  assert(partial.fonts.length === 1, `baytlari yo'q shriftlar o'tkazib yuborildi (${partial.fonts.length})`);
  assert(partial.rowOf(ids[0]) === 1 && partial.rowOf(ids[1]) === 0, "qisqartirilgan varaqada rowOf() to'g'ri");
  assert(pngSignature(partial.png), "qisqartirilgan varaqa ham haqiqiy PNG");
  assert(partial.height >= 1, `qisqartirilgan varaqa bo'sh emas (${partial.height} px)`);

  // Bo'sh ro'yxat ham yiqilmasligi kerak (chaqiruvchi bunga tayanadi).
  const empty = await renderFontSheet([], {});
  assert(pngSignature(empty.png) && empty.fonts.length === 0, "bo'sh ro'yxatda ham PNG qaytadi");

  if (failures > 0) {
    console.error(`TEKSHIRUV YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("Shrift varaqasi tekshiruvi o'tdi.");
}

main().catch((error) => {
  console.error("TEKSHIRUV YIQILDI:", error);
  process.exit(1);
});
