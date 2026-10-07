/**
 * Qo'lyozma shriftlari kutubxonasini yig'adi: `bun run fonts:fetch`
 *
 * Har bir nomzod shrift google/fonts repozitoriyasidan yuklab olinadi, keyin
 * opentype.js bilan tekshiriladi: fayl o'qiladimi, lotin/kirill belgilarini
 * qamrab oladimi, x-balandligi qanday (shriftlar orasida o'lchamni
 * tenglashtirish uchun). Natija `src/lib/handwriting/fonts.generated.ts`
 * faylida saqlanadi — dvigatel va UI shu ro'yxatdan foydalanadi.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import opentype from "opentype.js";
import { glyphContours, glyphAdvance, parseFont } from "../src/lib/handwriting/font";
import { InkCanvas } from "../src/lib/handwriting/raster";

const RAW = "https://raw.githubusercontent.com/google/fonts/main";
const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);
const LICENSE_DIR = new URL("../src/assets/fonts/licenses/", import.meta.url);
const MANIFEST = new URL("../src/lib/handwriting/fonts.generated.ts", import.meta.url);

type Category = "erkin" | "ozoda" | "bosma" | "kursiv" | "brus" | "bolalar";

interface Candidate {
  /** Papka nomi: `ofl/<dir>/` yoki `apache/<dir>/`. */
  dir: string;
  /** Kuzatiladigan fayl nomlari. */
  files: string[];
  label: string;
  category: Category;
  /** Litsenziya fayli manzili (papkaga nisbatan). */
  license: string;
}

const CANDIDATES: Candidate[] = [
  { dir: "ofl/caveat", files: ["Caveat[wght].ttf"], label: "Caveat — erkin qo'lyozma", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/marckscript", files: ["MarckScript-Regular.ttf"], label: "Marck Script — ozoda yozuv", category: "ozoda", license: "OFL.txt" },
  { dir: "ofl/badscript", files: ["BadScript-Regular.ttf"], label: "Bad Script — ingichka yozuv", category: "ozoda", license: "OFL.txt" },
  { dir: "ofl/neucha", files: ["Neucha.ttf", "Neucha-Regular.ttf"], label: "Neucha — bosma qo'lyozma", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/pangolin", files: ["Pangolin-Regular.ttf"], label: "Pangolin — bolalar yozuvi", category: "bolalar", license: "OFL.txt" },
  { dir: "ofl/underdog", files: ["Underdog-Regular.ttf"], label: "Underdog — keng yozuv", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/marmelad", files: ["Marmelad-Regular.ttf"], label: "Marmelad — yumaloq yozuv", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/yesevaone", files: ["YesevaOne-Regular.ttf"], label: "Yeseva One — tantanali kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/comforter", files: ["Comforter-Regular.ttf"], label: "Comforter — mo'yqalam yozuvi", category: "brus", license: "OFL.txt" },
  { dir: "ofl/lobster", files: ["Lobster-Regular.ttf"], label: "Lobster — bosilgan yozuv", category: "brus", license: "OFL.txt" },
  { dir: "ofl/lobstertwo", files: ["LobsterTwo-Regular.ttf"], label: "Lobster Two — bosma kursiv", category: "brus", license: "OFL.txt" },
  { dir: "ofl/pacifico", files: ["Pacifico-Regular.ttf"], label: "Pacifico — erkin kursiv", category: "brus", license: "OFL.txt" },
  { dir: "ofl/caveatbrush", files: ["CaveatBrush-Regular.ttf"], label: "Caveat Brush — bo'r yozuvi", category: "brus", license: "OFL.txt" },
  { dir: "ofl/dancingscript", files: ["DancingScript[wght].ttf"], label: "Dancing Script — jonli kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/shadowsintolight", files: ["ShadowsIntoLight.ttf", "ShadowsIntoLight-Regular.ttf"], label: "Shadows Into Light — yengil yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/shadowsintolighttwo", files: ["ShadowsIntoLightTwo-Regular.ttf"], label: "Shadows Into Light Two — ingichka yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/indieflower", files: ["IndieFlower-Regular.ttf"], label: "Indie Flower — bolalar yozuvi", category: "bolalar", license: "OFL.txt" },
  { dir: "ofl/patrickhand", files: ["PatrickHand-Regular.ttf"], label: "Patrick Hand — o'quvchi yozuvi", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/patrickhandsc", files: ["PatrickHandSC-Regular.ttf"], label: "Patrick Hand SC — yirik yozuv", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/architectsdaughter", files: ["ArchitectsDaughter-Regular.ttf"], label: "Architects Daughter — texnik yozuv", category: "bosma", license: "OFL.txt" },
  { dir: "ofl/kalam", files: ["Kalam-Regular.ttf"], label: "Kalam — tez yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/satisfy", files: ["Satisfy-Regular.ttf"], label: "Satisfy — imzo uslubi", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/greatvibes", files: ["GreatVibes-Regular.ttf"], label: "Great Vibes — hashamatli kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/sacramento", files: ["Sacramento-Regular.ttf"], label: "Sacramento — yupqa kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/homemadeapple", files: ["HomemadeApple-Regular.ttf"], label: "Homemade Apple — siyoh yozuvi", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/nothingyoucoulddo", files: ["NothingYouCouldDo.ttf", "NothingYouCouldDo-Regular.ttf"], label: "Nothing You Could Do — beparvo yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/lovedbytheking", files: ["LovedByTheKing.ttf", "LovedByTheKing-Regular.ttf"], label: "Loved by the King — nayza uchi yozuvi", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/coveredbyyourgrace", files: ["CoveredByYourGrace.ttf", "CoveredByYourGrace-Regular.ttf"], label: "Covered By Your Grace — kichik yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/mansalva", files: ["Mansalva-Regular.ttf"], label: "Mansalva — qalin qo'lyozma", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/comingsoon", files: ["ComingSoon.ttf", "ComingSoon-Regular.ttf"], label: "Coming Soon — daftar yozuvi", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/schoolbell", files: ["Schoolbell-Regular.ttf"], label: "Schoolbell — maktab yozuvi", category: "bolalar", license: "OFL.txt" },
  { dir: "ofl/craftygirls", files: ["CraftyGirls-Regular.ttf"], label: "Crafty Girls — o'quvchi daftari", category: "bolalar", license: "OFL.txt" },
  { dir: "ofl/reeniebeanie", files: ["ReenieBeanie.ttf", "ReenieBeanie-Regular.ttf"], label: "Reenie Beanie — bemalol yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/gloriahallelujah", files: ["GloriaHallelujah.ttf", "GloriaHallelujah-Regular.ttf"], label: "Gloria Hallelujah — yumshoq yozuv", category: "erkin", license: "OFL.txt" },
  { dir: "ofl/petitformalscript", files: ["PetitFormalScript-Regular.ttf"], label: "Petit Formal Script — nafis kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/parisienne", files: ["Parisienne-Regular.ttf"], label: "Parisienne — parijcha kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/monsieurladoulaise", files: ["MonsieurLaDoulaise-Regular.ttf", "MonsieurLaDoulaise.ttf"], label: "Monsieur La Doulaise — klassik kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/eaglelake", files: ["EagleLake-Regular.ttf"], label: "Eagle Lake — gotika yozuvi", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/amaticsc", files: ["AmaticSC-Regular.ttf"], label: "Amatic SC — ingichka baland yozuv", category: "brus", license: "OFL.txt" },
  { dir: "ofl/ruthie", files: ["Ruthie-Regular.ttf"], label: "Ruthie — kayfiyatli kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/mrdehaviland", files: ["MrDeHaviland-Regular.ttf"], label: "Mr De Haviland — sovuq kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/engagement", files: ["Engagement-Regular.ttf"], label: "Engagement — to'y kursivi", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/allura", files: ["Allura-Regular.ttf"], label: "Allura — silliq kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/tangerine", files: ["Tangerine-Regular.ttf"], label: "Tangerine — yupqa kursiv", category: "kursiv", license: "OFL.txt" },
  { dir: "ofl/italianno", files: ["Italianno-Regular.ttf"], label: "Italianno — vertikal kursiv", category: "kursiv", license: "OFL.txt" },
];

/** O'lchamni tenglashtirish uchun etalon x-balandlik (`Caveat`). */
const REFERENCE_X_HEIGHT = 0.34;

const LATIN = "AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789.,;:!?'\"()-+=/%";
const CYRILLIC = "АаБбВвГгДдЕеЁёЖжЗзИиЙйКкЛлМмНнОоӨөПпРрСсТтУуЎўФфХхЦцЧчШшЩщЪъЫыЬьЭэЮюЯяҒғҚқҲҳ";
const MATH = "√∫∑±×÷≤≥≠≈∞π°∠⊥∥→⇒αβγθλμ∆";
/** O'zbek lotin matnida ko'p ishlatiladigan belgilar. */
const UZBEK = "o'g'O'G'ʻʼ";

interface Measured {
  latin: number;
  cyrillic: number;
  math: number;
  xHeight: number;
  capHeight: number;
}

function coverage(font: opentype.Font, chars: string): number {
  let found = 0;
  for (const ch of chars) {
    try {
      if (font.charToGlyphIndex(ch) > 0) found += 1;
    } catch {
      /* e'tiborsiz */
    }
  }
  return found / chars.length;
}

function measure(font: opentype.Font): Measured {
  const glyphHeight = (ch: string): number => {
    try {
      const glyph = font.charToGlyph(ch);
      if (!glyph || font.charToGlyphIndex(ch) === 0) return 0;
      // opentype.js bbox'i { x1, y1, x2, y2 } qaytaradi (y2 — tepa).
      const box = glyph.getBoundingBox();
      const height = (box.y2 - Math.max(0, box.y1)) / font.unitsPerEm;
      return Number.isFinite(height) && height > 0 ? height : 0;
    } catch {
      return 0;
    }
  };

  return {
    latin: coverage(font, LATIN + UZBEK),
    cyrillic: coverage(font, CYRILLIC),
    math: coverage(font, MATH),
    xHeight: glyphHeight("x") || glyphHeight("о") || 0.32,
    capHeight: glyphHeight("H") || glyphHeight("Н") || 0.6,
  };
}

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

interface Entry {
  id: string;
  label: string;
  family: string;
  file: string;
  category: Category;
  cyrillic: boolean;
  latin: boolean;
  mathScore: number;
  sizeScale: number;
  /** Siyoh quyuqligi: "n" harfi qancha joyni bo'yaydi (juda ingichka shriftlar uchun). */
  inkDensity: number;
  license: string;
}

/**
 * Shriftning shtrix quyuqligini o'lchaydi: "n" harfini 100 px o'lchamda
 * chizib, bo'yalgan maydonning harf maydoniga nisbatini hisoblaydi.
 * Juda kichik qiymat — qalam izi deyarli ko'rinmaydigan shrift (masalan Amatic SC).
 */
function measureInkDensity(id: string, bytes: Uint8Array): number {
  try {
    const handle = parseFont(id, bytes);
    const size = 100;
    const contours = glyphContours(handle, "n");
    if (!contours) return 0.1;

    const width = 260;
    const height = 200;
    const originX = 30;
    const baseline = 150;
    const canvas = new InkCanvas(width, height, 3);
    canvas.fill(
      contours.map((contour) =>
        contour.map((point) => ({ x: originX + point.x * size, y: baseline + point.y * size })),
      ),
    );
    const coverage = canvas.resolve(new Float32Array(width * height));

    let inked = 0;
    for (let i = 0; i < coverage.length; i += 1) {
      if (coverage[i] > 0.5) inked += 1;
    }

    // Natija — "n" harfi egallagan maydon (em² larda). Qalin shtrixli shriftlar
    // katta qiymat beradi; juda kichik qiymat esa qalam izi o'chib
    // ko'rinadigan shriftni bildiradi.
    void glyphAdvance;
    return Number((inked / (size * size)).toFixed(4));
  } catch {
    return 0.1;
  }
}

function idFor(dir: string): string {
  return dir.split("/")[1];
}

async function main(): Promise<void> {
  await mkdir(FONT_DIR, { recursive: true });
  await mkdir(LICENSE_DIR, { recursive: true });

  const entries: Entry[] = [];
  const skipped: string[] = [];

  for (const candidate of CANDIDATES) {
    const id = idFor(candidate.dir);
    let bytes: Uint8Array | null = null;
    let file = "";

    for (const name of candidate.files) {
      const target = new URL(name, FONT_DIR);
      if (existsSync(target)) {
        bytes = new Uint8Array(await readFile(target));
        file = name;
        break;
      }
      const fetched = await download(`${RAW}/${candidate.dir}/${encodeURIComponent(name).replace(/%5B/g, "[").replace(/%5D/g, "]")}`);
      if (fetched) {
        bytes = fetched;
        file = name;
        await writeFile(target, fetched);
        break;
      }
    }

    if (!bytes) {
      skipped.push(`${id} (fayl topilmadi)`);
      continue;
    }

    let font: opentype.Font;
    try {
      font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (error) {
      skipped.push(`${id} (o'qilmadi: ${(error as Error).message})`);
      continue;
    }

    const measured = measure(font);
    if (measured.latin < 0.9) {
      skipped.push(`${id} (lotin qamrovi past: ${(measured.latin * 100).toFixed(0)}%)`);
      continue;
    }

    // Litsenziya matnini ham saqlaymiz.
    const licenseTarget = new URL(`${id}.txt`, LICENSE_DIR);
    if (!existsSync(licenseTarget)) {
      const text = await download(`${RAW}/${candidate.dir}/${candidate.license}`);
      if (text) await writeFile(licenseTarget, text);
    }

    const sizeScale = Math.min(1.4, Math.max(0.75, REFERENCE_X_HEIGHT / measured.xHeight));
    const inkDensity = measureInkDensity(id, bytes);

    // Ko'rsatiladigan nom: nomzodlar jadvalidagi "Family — tavsif" yozuvining
    // oilaviy qismi. Shriftning o'z nom jadvali variativ shriftlarda bo'sh
    // bo'lishi mumkin, shuning uchun uni faqat zaxira sifatida ishlatamiz.
    const family =
      candidate.label.split("—")[0]?.trim() ||
      (font as unknown as { getEnglishName?: (name: string) => string | undefined }).getEnglishName?.(
        "fontFamily",
      ) ||
      id;

    entries.push({
      id,
      label: candidate.label,
      family,
      file,
      category: candidate.category,
      cyrillic: measured.cyrillic >= 0.6,
      latin: measured.latin >= 0.9,
      mathScore: Math.round(measured.math * 100),
      sizeScale: Number(sizeScale.toFixed(3)),
      inkDensity,
      license: `${id}.txt`,
    });

    console.log(
      `✓ ${id.padEnd(20)} lotin ${(measured.latin * 100).toFixed(0).padStart(3)}%  kirill ${(
        measured.cyrillic * 100
      )
        .toFixed(0)
        .padStart(3)}%  x-balandlik ${measured.xHeight.toFixed(3)}  o'lcham ${sizeScale.toFixed(
        2,
      )}  quyuqlik ${inkDensity.toFixed(3)}`,
    );
  }

  entries.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));

  const source = `// AVTOMATIK ISHLAB CHIQARILGAN FAYL — qo'lda tahrirlamang.
// Yangilash: bun run fonts:fetch
//
// Har bir yozuv google/fonts repozitoriyasidan yuklab olingan qo'lyozma
// shriftini tasvirlaydi: qaysi belgilarni qamrab olishi, x-balandligi va
// shunga mos o'lcham koeffitsienti (shriftlar bir xil ko'rinishda bo'lishi uchun).

export type FontCategory = ${Array.from(new Set(entries.map((entry) => `"${entry.category}"`))).join(" | ")};

export interface FontLibraryEntry {
  /** Dvigatelda ishlatiladigan identifikator (masalan "caveat"). */
  id: string;
  /** UI va botda ko'rsatiladigan nom. */
  label: string;
  /** Shriftning haqiqiy oilaviy nomi. */
  family: string;
  /** \`src/assets/fonts/\` ichidagi fayl nomi. */
  file: string;
  category: FontCategory;
  /** Kirill harflari bormi (rus tilidagi matn uchun). */
  cyrillic: boolean;
  /** Lotin harflari to'liqmi. */
  latin: boolean;
  /** Matematik belgilar qamrovi (foizda) — qolgani qalam harakatlari bilan chiziladi. */
  mathScore: number;
  /** O'lcham koeffitsienti: x-balandligi kichik shriftlar kattaroq chiziladi. */
  sizeScale: number;
  /**
   * "n" harfi egallagan maydon (em²). 0.028 dan kichik bo'lsa shtrix juda
   * ingichka bo'lgani uchun chizishda biroz qalinlashtiriladi.
   */
  inkDensity: number;
  /** Litsenziya fayli (\`src/assets/fonts/licenses/\`). */
  license: string;
}

/** Chizish uchun yetim belgi qolsa ishlatiladigan zaxira shrift. */
export const FALLBACK_FONT_ID = "caveat";

export const FONT_LIBRARY: FontLibraryEntry[] = [
${entries
  .map(
    (entry) =>
      `  { id: "${entry.id}", label: ${JSON.stringify(entry.label)}, family: ${JSON.stringify(
        entry.family,
      )}, file: ${JSON.stringify(entry.file)}, category: "${entry.category}", cyrillic: ${
        entry.cyrillic
      }, latin: ${entry.latin}, mathScore: ${entry.mathScore}, sizeScale: ${entry.sizeScale}, inkDensity: ${
        entry.inkDensity
      }, license: ${JSON.stringify(entry.license)} },`,
  )
  .join("\n")}
];

export function fontEntry(id: string): FontLibraryEntry | undefined {
  return FONT_LIBRARY.find((entry) => entry.id === id);
}

/** Shrift topilmasa yoki zaxira kerak bo'lsa ishlatiladi. */
export function fallbackEntry(): FontLibraryEntry {
  return fontEntry(FALLBACK_FONT_ID) ?? FONT_LIBRARY[0];
}
`;

  await writeFile(MANIFEST, source);

  console.log(`\nJami ${entries.length} shrift qo'shildi, ${skipped.length} nomzod tushib qoldi.`);
  if (skipped.length > 0) console.log(`Tushib qolganlar: ${skipped.join(", ")}`);
  const cyrillic = entries.filter((entry) => entry.cyrillic).length;
  console.log(`Kirill matnini qo'llab-quvvatlaydigan shriftlar: ${cyrillic}`);
}

main().catch((error) => {
  console.error("SHRIFT YIG'ISH YIQILDI:", error);
  process.exit(1);
});
