/**
 * Studio matn asboblari tekshiruvi.
 *
 * Studio'da matnni o'zgartiruvchi tugmalar bor (bo'shliqni tozalash, bo'sh
 * qatorlarni birlashtirish yoki olib tashlash, registr). Ular foydalanuvchi
 * yozgan matnni buzmasligi kerak: shuning uchun amallar `src/lib/handwriting/
 * text-tools.ts` da toza funksiya sifatida turadi va shu yerda tekshiriladi.
 *
 * Ikkinchi qism o'lcham tayyorliklariga tegishli: `GEOMETRY_PRESETS` (Zich /
 * O'rta / Keng) Studio'dagi surilmalar oraliqlari ichida bo'lishi va «O'rta»
 * aynan standart uslubga to'g'ri kelishi kerak. Aks holda tugma bosilganda
 * qiymat botda boshqacha talqin qilinardi (bot o'z oralig'iga qisqartiradi).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  changeCase,
  collapseBlankLines,
  hasText,
  removeEmptyLines,
  statsSummary,
  textLines,
  textStats,
  trimLines,
} from "../src/lib/handwriting/text-tools";
import { GEOMETRY_PRESETS, STYLE_RANGES } from "../src/lib/handwriting/options";
import { DEFAULT_STYLE } from "../src/lib/handwriting/types";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${message}`);
}

/** Ikki qiymat tengligini ko'rsatib tekshiradi (xato bo'lsa ko'rinadi). */
function assertEqual(actual: string | number, expected: string | number, message: string): void {
  assert(
    actual === expected,
    actual === expected ? message : `${message} — kutilgan ${JSON.stringify(expected)}, olindi ${JSON.stringify(actual)}`,
  );
}

/* ------------------------------------------------------------------ */
/* 1-qism: qatorlarga ajratish va hisoblagich                           */
/* ------------------------------------------------------------------ */

function checkStats(): void {
  console.log("\n=== 1-qism: matn hisoblagichi ===");

  const empty = textStats("");
  assert(
    empty.chars === 0 && empty.trimmed === 0 && empty.words === 0 && empty.lines === 0,
    "bo'sh matnda hamma ko'rsatkich 0 (bo'linish xatosi yo'q)",
  );
  assert(empty.filled === 0 && empty.empty === 0 && empty.longest === 0, "bo'sh matnda qatorlar ham 0");
  assert(!hasText(""), "bo'sh matn `hasText()` da bo'sh deb topiladi");
  assert(!hasText("   \n  "), "faqat bo'shliqdan iborat matn ham bo'sh hisoblanadi");

  const sample = "Salom dunyo\n\nYana bir qator";
  const stats = textStats(sample);
  assertEqual(stats.lines, 3, "uch qatorli matn 3 qator deb sanaldi");
  assertEqual(stats.filled, 2, "matni bor qatorlar 2 ta");
  assertEqual(stats.empty, 1, "bo'sh qatorlar 1 ta");
  assertEqual(stats.words, 5, "so'zlar bo'shliq bilan sanaldi (5 so'z)");
  assertEqual(stats.longest, "Yana bir qator".length, "eng uzun qator topildi");
  assertEqual(stats.chars, sample.length, "belgi soni matn uzunligiga teng");
  assertEqual(
    stats.trimmed,
    sample.length,
    "chetda bo'shliq bo'lmasa `trimmed` matn uzunligiga teng (bot shuni tekshiradi)",
  );
  assertEqual(textStats("  salom  ").trimmed, 5, "chet bo'shliqlari `trimmed` dan chiqarildi");

  // Windows'dagi qator ko'rinishi: `\r` daftar satriga tushib qolmasligi kerak.
  const crlf = "birinchi\r\nikkinchi\r\n";
  assertEqual(textLines(crlf).length, 3, "`\\r\\n` ajratgichi qator sifatida o'qildi");
  assert(!crlf.includes("\r") || trimLines(crlf).includes("\r") === false, "`\\r` belgisi chiqishdan olib tashlandi");
  assertEqual(trimLines(crlf), "birinchi\nikkinchi\n", "`\\r\\n` matn `\\n` ga keltirildi");
}

/* ------------------------------------------------------------------ */
/* 2-qism: asboblar (tozalash, birlashtirish, registr)                  */
/* ------------------------------------------------------------------ */

function checkTools(): void {
  console.log("\n=== 2-qism: matn asboblari ===");

  assertEqual(trimLines("  salom  \n  dunyo  "), "salom\ndunyo", "har bir qatordagi chet bo'shliqlari olindi");
  assertEqual(trimLines("a\n\n b "), "a\n\nb", "tozalash bo'sh qatorni saqlab qoladi");

  assertEqual(
    collapseBlankLines("sarlavha\n\n\n\nmatn\n\n\n"),
    "sarlavha\n\nmatn",
    "ketma-ket bo'sh qatorlar bittaga tushdi va oxirgisi olib tashlandi",
  );
  assertEqual(collapseBlankLines("a\nb"), "a\nb", "bo'sh qator bo'lmasa matn o'zgarmadi");
  assertEqual(collapseBlankLines("   \n\n\t\n"), "", "faqat bo'shliqdan iborat matn tozalandi");

  assertEqual(removeEmptyLines("a\n\n \nb\n"), "a\nb", "bo'sh qatorlar butunlay olib tashlandi");
  assertEqual(removeEmptyLines("a\n\nb\n\nc"), "a\nb\nc", "qator tartibi saqlanib qoldi");

  assertEqual(changeCase("salom dunyo", "upper"), "SALOM DUNYO", "katta harflar");
  assertEqual(changeCase("SALOM", "lower"), "salom", "kichik harflar");
  assertEqual(changeCase("salom dunyo", "title"), "Salom Dunyo", "har bir so'z bosh harf bilan");
  assertEqual(changeCase("A. oripov", "title"), "A. Oripov", "qisqartma harfi saqlanib qoldi");
  assertEqual(changeCase("o'zbek tili", "title"), "O'zbek Tili", "apostrof so'zni ajratmadi");
  assertEqual(changeCase("x^2 + y_1", "title"), "X^2 + Y_1", "formula belgilariga tegilmaydi");

  // Takror qo'llash natijani o'zgartirmasligi kerak (tugmani ikki marta bosish).
  const messy = "  a  \n\n\n   b \n\n";
  const once = trimLines(messy);
  assertEqual(trimLines(once), once, "tozalashni takrorlash natijani o'zgartirmaydi");
  const collapsed = collapseBlankLines(messy);
  assertEqual(collapseBlankLines(collapsed), collapsed, "birlashtirishni takrorlash natijani o'zgartirmaydi");
  const stripped = removeEmptyLines(messy);
  assertEqual(removeEmptyLines(stripped), stripped, "olib tashlashni takrorlash natijani o'zgartirmaydi");

  // Bo'sh matnda asboblar yiqilmaydi va bo'sh qoladi.
  assertEqual(removeEmptyLines(""), "", "bo'sh matnda olib tashlash xato bermaydi");
  assertEqual(collapseBlankLines(""), "", "bo'sh matnda birlashtirish xato bermaydi");

  assertEqual(statsSummary(textStats("salom dunyo")), "1 qator · 2 so'z · 11 belgi", "hisoblagich izohi");
}

/* ------------------------------------------------------------------ */
/* 3-qism: o'lcham tayyorliklari va surilma oraliqlari                  */
/* ------------------------------------------------------------------ */

async function checkGeometry(): Promise<void> {
  console.log("\n=== 3-qism: o'lcham tayyorliklari ===");

  assertEqual(GEOMETRY_PRESETS.length, 3, "uchta tayyor o'lcham bor (Zich / O'rta / Keng)");

  const middle = GEOMETRY_PRESETS.find((preset) => preset.id === "orta");
  assert(middle !== undefined, "«O'rta» tayyorlik topildi");
  assert(
    middle?.style.fontSize === DEFAULT_STYLE.fontSize &&
      middle?.style.lineGap === DEFAULT_STYLE.lineGap &&
      middle?.style.marginLeft === DEFAULT_STYLE.marginLeft,
    "«O'rta» aynan standart uslubga to'g'ri keladi",
  );

  const inside = (value: number, range: { min: number; max: number }) =>
    value >= range.min && value <= range.max;
  assert(
    GEOMETRY_PRESETS.every(
      (preset) =>
        inside(preset.style.fontSize, STYLE_RANGES.fontSize) &&
        inside(preset.style.lineGap, STYLE_RANGES.lineGap) &&
        inside(preset.style.marginLeft, STYLE_RANGES.marginLeft),
    ),
    "hamma tayyorlik qiymatlari surilmalar oraliqlari ichida (qiymat sakramaydi)",
  );

  // Studio surilmalari va chegaralarni tekshiradigan bot oralig'i mos bo'lishi
  // kerak: aks holda bot qiymatni qisqartirib, Studio'da ko'rsatilgan o'lcham
  // serverda boshqacha chiqadi.
  const clientFile = fileURLToPath(new URL("../src/lib/telegram/mini-app.ts", import.meta.url));
  const client = await readFile(clientFile, "utf8");
  const ranges = [...client.matchAll(/(FONT_SIZE_RANGE|LINE_GAP_RANGE|MARGIN_LEFT_RANGE) = \[(\d+), (\d+)\]/g)];
  assert(ranges.length === 3, "botning o'lcham oraliqlari o'qildi");
  const byName = new Map(ranges.map((match) => [match[1], { min: Number(match[2]), max: Number(match[3]) }]));
  const pairs: [string, { min: number; max: number }][] = [
    ["FONT_SIZE_RANGE", STYLE_RANGES.fontSize],
    ["LINE_GAP_RANGE", STYLE_RANGES.lineGap],
    ["MARGIN_LEFT_RANGE", STYLE_RANGES.marginLeft],
  ];
  for (const [name, range] of pairs) {
    const bot = byName.get(name);
    assert(
      bot !== undefined && range.min >= bot.min && range.max <= bot.max,
      `Studio oraliqi bot oraliqi ichida (${name}: ${range.min}–${range.max} ⊂ ${bot?.min}–${bot?.max})`,
    );
  }

  if (failures > 0) {
    console.error(`\nMATN TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nMatn tekshiruvi o'tdi: hisoblagich → asboblar → o'lcham tayyorliklari.");
}

checkStats();
checkTools();
await checkGeometry();
