/**
 * "Uslubimni nusxalash" funksiyasini tekshiradi: `bun run check:style`
 *
 * Bu yerda haqiqiy dvigatel ishlatiladi: ma'lum qiyalik/qalinlik bilan varaqa
 * chiziladi, keyin u xuddi foydalanuvchi rasmi kabi o'lchanadi. Shunday qilib
 * o'lchovning to'g'riligi (round-trip) tekshiriladi:
 *   1. qiyalik: 12° qo'shilsa, o'lchov ham ~12° o'sishi kerak;
 *   2. qalinlik: weight 1.6 bo'lsa, o'lchangan shtrix sezilarli qalin;
 *   3. kenglik: stretch 1.4 bo'lsa, harflar kengroq o'lchanadi;
 *   4. kalibrlash o'zini tanidi (identity): o'lchangan shrift nomzodlar
 *      orasidan aynan o'sha shriftni topadi;
 *   5. shaxsiy uslub haqiqatan chizmani o'zgartiradi (siyoh ko'lami, qamrov);
 *   6. namunadan uslub qaytarib olinadi (recovery: 10° / 1.5 / 1.25 / 1.15);
 *   7. yaroqsiz namuna (bo'sh varaq) rad etiladi;
 *   9. «Boshqacha yozsin» ko'rinadigan o'zgarish beradi: yangi urug' bilan
 *      boshqa shrift tanlanadi va varaqadagi siyoh faqat urug' o'zgargandan
 *      ancha ko'proq farq qiladi.
 */
import { readFile } from "node:fs/promises";
import {
  calibrateStyle,
  derivePersonalStyle,
  measureFont,
  personalSummary,
} from "../src/lib/handwriting/calibrate";
import { renderNotebook } from "../src/lib/handwriting/render";
import { analyzeSample, mergeProfiles, sampleQuality } from "../src/lib/handwriting/sample";
import { FALLBACK_FONT_ID, fontEntry } from "../src/lib/handwriting/fonts.generated";
import { shuffleHandwriting } from "../src/lib/handwriting/options";
import { DEFAULT_STYLE, type FontId, type PersonalStyle } from "../src/lib/handwriting/types";

const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

async function loadFont(id: FontId): Promise<Uint8Array> {
  const entry = fontEntry(id);
  if (!entry) throw new Error(`"${id}" shrifti manifestda topilmadi`);
  return new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
}

const SAMPLE_TEXT = "Abcdegkmnopqrsta hijkwxyz ABCDEFG Ko'rinish dartslari 01234";

/** Namuna varaqasini chizib, o'lchovlarini qaytaradi. */
async function measureWith(
  fonts: Record<FontId, Uint8Array>,
  font: FontId,
  personal?: Partial<PersonalStyle>,
): Promise<ReturnType<typeof analyzeSample>> {
  const result = await renderNotebook({
    text: SAMPLE_TEXT,
    style: {
      ...DEFAULT_STYLE,
      font,
      paper: "plain",
      marginLine: false,
      pageFormat: "strip",
      fontSize: 44,
      wobble: 0.35,
      seed: 11,
      mathMode: false,
      ...(personal ? { personal: { ...neutral(), ...personal, baseFont: font } } : {}),
    },
    fonts,
  });
  const page = result.pages[0];
  return analyzeSample({ width: page.width, height: page.height, data: page.rgba });
}

/** Neytral shaxsiy uslub (faqat bitta xususiyatni o'zgartirish uchun asos). */
function neutral(): PersonalStyle {
  return {
    baseFont: FALLBACK_FONT_ID,
    slant: 0,
    stretch: 1,
    weight: 1,
    tracking: 1,
    wobble: 0.35,
    drift: 0,
    sizeScale: 1,
  };
}

async function main(): Promise<void> {
  const ids: FontId[] = ["caveat", "marckscript", "neucha", "pangolin", "lobster", "badscript"];
  const fonts: Record<FontId, Uint8Array> = {};
  for (const id of ids) fonts[id] = await loadFont(id);
  fonts[FALLBACK_FONT_ID] = fonts[FALLBACK_FONT_ID] ?? (await loadFont(FALLBACK_FONT_ID));

  const baseFont: FontId = "caveat";

  console.log("=== 1-holat: qiyalik o'lchovi (round-trip) ===");
  const straight = await measureWith(fonts, baseFont);
  const slanted = await measureWith(fonts, baseFont, { slant: 12 });
  console.log(`  qiyalik: tekis ${straight.slant}° → 12° qo'shilganda ${slanted.slant}°`);
  assert(Math.abs(slanted.slant - straight.slant - 12) <= 3.5, "qo'shilgan 12° qiyalik o'lchovda ko'rindi");
  const leaningBack = await measureWith(fonts, baseFont, { slant: -10 });
  assert(
    leaningBack.slant < straight.slant - 4,
    `chapga qiyalik ham o'lchanadi (${leaningBack.slant}° < ${straight.slant}°)`,
  );

  console.log("\n=== 2-holat: shtrix qalinligi ===");
  const thin = await measureWith(fonts, baseFont, { weight: 0.8 });
  const bold = await measureWith(fonts, baseFont, { weight: 1.6 });
  console.log(`  qalinlik: weight 0.8 → ${thin.thickness.toFixed(3)}, weight 1.6 → ${bold.thickness.toFixed(3)}`);
  assert(
    bold.thickness > thin.thickness * 1.15,
    `qalin yozuv aniq qalinroq o'lchandi (${(bold.thickness / thin.thickness).toFixed(2)}x)`,
  );

  console.log("\n=== 3-holat: harf kengligi (stretch) ===");
  const narrow = await measureWith(fonts, baseFont, { stretch: 0.8 });
  const wide = await measureWith(fonts, baseFont, { stretch: 1.4 });
  console.log(
    `  shakl nisbati: stretch 0.8 → ${narrow.aspect.toFixed(3)}, stretch 1.4 → ${wide.aspect.toFixed(3)}`,
  );
  assert(wide.aspect > narrow.aspect * 1.15, "kengaytirilgan yozuvda harflar kengroq o'lchandi");
  const spaced = await measureWith(fonts, baseFont, { tracking: 1.3 });
  const defaultTracking = await measureWith(fonts, baseFont, { tracking: 1 });
  console.log(
    `  oraliq: tracking 1 → ${defaultTracking.tracking.toFixed(3)}, tracking 1.3 → ${spaced.tracking.toFixed(3)}`,
  );
  assert(spaced.tracking > defaultTracking.tracking * 1.05, "oraliq o'zi ham o'lchovda ko'rindi");

  console.log("\n=== 4-holat: kalibrlash o'zini tanidi ===");
  const userProfile = await measureFont(baseFont, fonts);
  assert(Boolean(userProfile), "namuna o'lchandi");
  const calibration = await calibrateStyle({ profile: userProfile!, fonts });
  console.log(
    `  eng yaqin: ${calibration.baseFont} (masofa ${calibration.candidates[0].distance.toFixed(3)}), nomzodlar: ${calibration.candidates
      .map((candidate) => `${candidate.id}:${candidate.distance.toFixed(2)}`)
      .join(", ")}`,
  );
  assert(calibration.baseFont === baseFont, `shrift o'zini tanidi (${calibration.baseFont} = ${baseFont})`);
  assert(calibration.candidates.length === ids.length, `barcha ${ids.length} nomzod o'lchandi`);
  assert(
    calibration.candidates[0].distance < (calibration.candidates[1]?.distance ?? 1),
    "eng yaqin nomzod ikkinchisidan aniq ajralib turadi",
  );
  assert(
    Math.abs(calibration.personal.slant) < 4 && Math.abs(calibration.personal.weight - 1) < 0.25,
    `o'z-o'zini kalibrlashda tuzatishlar kichik (qiyalik ${calibration.personal.slant}°, qalinlik ${calibration.personal.weight})`,
  );

  console.log("\n=== 5-holat: boshqa shriftni aniqlash ===");
  const otherProfile = await measureFont("badscript", fonts);
  const otherCalibration = await calibrateStyle({ profile: otherProfile!, fonts });
  assert(otherCalibration.baseFont === "badscript", `boshqa shrift ham to'g'ri aniqlandi (${otherCalibration.baseFont})`);

  console.log("\n=== 6-holat: uslub chizmani o'zgartiradi ===");
  const plainPage = await renderNotebook({
    text: "Salom, bu mening yozuvim.",
    style: { ...DEFAULT_STYLE, font: baseFont, pageFormat: "strip", fontSize: 40 },
    fonts,
  });
  const styledPage = await renderNotebook({
    text: "Salom, bu mening yozuvim.",
    style: {
      ...DEFAULT_STYLE,
      font: baseFont,
      pageFormat: "strip",
      fontSize: 40,
      personal: { ...neutral(), baseFont, slant: 16, weight: 1.5, stretch: 1.2, tracking: 1.15 },
    },
    fonts,
  });
  const countInk = (page: { width: number; height: number; rgba: Uint8ClampedArray }): number => {
    let ink = 0;
    for (let at = 0; at < page.rgba.length; at += 4) {
      if ((page.rgba[at] + page.rgba[at + 1] + page.rgba[at + 2]) / 3 < 205) ink += 1;
    }
    return ink;
  };
  const plainInk = countInk(plainPage.pages[0]);
  const styledInk = countInk(styledPage.pages[0]);
  console.log(`  siyoh piksellari: oddiy ${plainInk}, shaxsiy uslubda ${styledInk}`);
  assert(styledInk > plainInk * 1.15, "shaxsiy uslub chizmani sezilarli o'zgartirdi (qiyalik + qalinlik)");
  const styledProfile = analyzeSample({
    width: styledPage.pages[0].width,
    height: styledPage.pages[0].height,
    data: styledPage.pages[0].rgba,
  });
  const plainProfile = analyzeSample({
    width: plainPage.pages[0].width,
    height: plainPage.pages[0].height,
    data: plainPage.pages[0].rgba,
  });
  assert(
    styledProfile.slant > plainProfile.slant + 6,
    `chizilgan varaqda qiyalik ham o'lchandi (${plainProfile.slant}° → ${styledProfile.slant}°)`,
  );

  console.log("\n=== 7-holat: namunadan uslubni qaytarib olish ===");
  const truth: PersonalStyle = { ...neutral(), baseFont, slant: 10, weight: 1.5, stretch: 1.25, tracking: 1.15 };
  const userSample = await measureWith(fonts, baseFont, truth);
  const baseSample = await measureWith(fonts, baseFont);
  const recovered = derivePersonalStyle(userSample, baseSample, baseFont);
  console.log(
    `  haqiqiy: qiyalik 10°, qalinlik 1.50, kenglik 1.25, oraliq 1.15 → hisoblandi: qiyalik ${recovered.slant}°, qalinlik ${recovered.weight}, kenglik ${recovered.stretch}, oraliq ${recovered.tracking}`,
  );
  assert(
    Math.abs(recovered.slant - truth.slant) <= 6,
    `qiyalik qaytarib olindi (${recovered.slant}° ≈ 10°)`,
  );
  assert(
    Math.abs(recovered.weight - truth.weight) <= 0.4,
    `qalinlik qaytarib olindi (${recovered.weight} ≈ 1.50)`,
  );
  assert(
    recovered.stretch > 1.02 && recovered.stretch <= 1.35,
    `kenglik to'g'ri tomonga surildi (${recovered.stretch})`,
  );
  assert(
    recovered.tracking > 1.03 && recovered.tracking <= 1.3,
    `oraliq to'g'ri tomonga surildi (${recovered.tracking})`,
  );

  console.log("\n=== 8-holat: yaroqsiz namuna va yordamchi funksiyalar ===");
  const blank = analyzeSample({ width: 200, height: 120, data: new Uint8ClampedArray(200 * 120 * 4).fill(240) });
  assert(sampleQuality(blank).ok === false, `bo'sh varaq rad etildi: "${sampleQuality(blank).reason}"`);
  assert(sampleQuality(blank, { minLines: 1 }).ok === false, "kamida 1 satr talab qilinganda ham rad etiladi");
  assert(sampleQuality(straight).ok === true, "chizilgan namuna yaroqli deb topildi");
  assert(
    sampleQuality({ ...straight, lines: 1 }).ok === false,
    "juda kam satr bo'lsa qayta yozish so'raladi",
  );

  const merged = mergeProfiles(straight, slanted);
  assert(merged.lines === straight.lines + slanted.lines, "so'z va raqam namunalari birlashtirildi");
  assert(merged.thickness === slanted.thickness, "raqamlar namunasi qalinlik uchun ustuvor");
  assert(mergeProfiles(straight, null).thickness === straight.thickness, "raqamlar namunasi bo'lmasa so'zlar ishlatiladi");

  const derived = derivePersonalStyle(straight, slanted, baseFont);
  assert(
    derived.slant >= -22 && derived.slant <= 22 && derived.weight >= 0.7 && derived.weight <= 1.9,
    `hisoblangan uslub chegaralar ichida (qiyalik ${derived.slant}°, qalinlik ${derived.weight})`,
  );
  const summary = personalSummary({ ...neutral(), slant: 14, weight: 1.4, stretch: 1.2 });
  assert(summary.includes("qiyalik") && summary.includes("qalin"), `qisqa izoh o'qishga qulay: "${summary}"`);

  console.log("\n=== 9-holat: «Boshqacha yozsin» ko'rinadigan o'zgarish beradi ===");
  const variantText = "Salom, bu mening yozuvim. Vatan haqida 0123";
  const variantBase = {
    ...DEFAULT_STYLE,
    font: baseFont,
    pageFormat: "strip" as const,
    fontSize: 40,
  };
  /** Varaqadagi siyoh qayerda ekanini ko'rsatuvchi niqob. */
  const inkMaskOf = (page: { rgba: Uint8ClampedArray }): Uint8Array => {
    const mask = new Uint8Array(page.rgba.length / 4);
    for (let at = 0; at < page.rgba.length; at += 4) {
      if ((page.rgba[at] + page.rgba[at + 1] + page.rgba[at + 2]) / 3 < 205) mask[at / 4] = 1;
    }
    return mask;
  };
  /** Ikki chizmaning siyohi qanchalik mos keladi (1 — butunlay bir xil). */
  const maskOverlap = (a: Uint8Array, b: Uint8Array): number => {
    let both = 0;
    let either = 0;
    for (let at = 0; at < a.length; at += 1) {
      if (a[at] === 1 || b[at] === 1) either += 1;
      if (a[at] === 1 && b[at] === 1) both += 1;
    }
    return either === 0 ? 1 : both / either;
  };

  const baseMask = inkMaskOf(
    (await renderNotebook({ text: variantText, style: variantBase, fonts })).pages[0],
  );
  const seedOnly = await renderNotebook({
    text: variantText,
    style: { ...variantBase, seed: variantBase.seed + 424_242 },
    fonts,
  });
  const seedOnlyOverlap = maskOverlap(baseMask, inkMaskOf(seedOnly.pages[0]));

  // Fonni tanlash `seed` orqali aniqlanadi — ya'ni takrorlanadigan bo'lishi kerak.
  const variantSeed = 424_242;
  const variant = shuffleHandwriting(variantBase, variantSeed);
  assert(
    variant.font !== variantBase.font,
    `boshqa yozuv uslubi tanlandi (${variantBase.font} → ${variant.font})`,
  );
  assert(variant.seed === variantSeed, `yangi urug' o'z holicha saqlanadi (${variant.seed})`);
  assert(
    shuffleHandwriting(variantBase, variantSeed).font === variant.font,
    "bir xil urug' — bir xil tanlov (natija takrorlanadi)",
  );

  fonts[variant.font] = fonts[variant.font] ?? (await loadFont(variant.font));
  const variantResult = await renderNotebook({
    text: variantText,
    style: { ...variantBase, ...variant },
    fonts,
  });
  assert(
    variantResult.warnings.length === 0,
    `tanlangan shrift chizildi (${variant.font}, ogohlantirishsiz)`,
  );
  const variantOverlap = maskOverlap(baseMask, inkMaskOf(variantResult.pages[0]));
  console.log(
    `  siyoh mosligi: faqat urug' — ${seedOnlyOverlap.toFixed(2)}, boshqa uslub — ${variantOverlap.toFixed(2)}`,
  );
  assert(
    variantOverlap < 0.75 && variantOverlap < seedOnlyOverlap - 0.1,
    `«Boshqacha yozsin» ko'rinadigan o'zgarish beradi (moslik ${variantOverlap.toFixed(2)} < ${seedOnlyOverlap.toFixed(2)})`,
  );

  if (failures > 0) {
    console.error(`\nUSLUB TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nUslub tekshiruvi o'tdi: o'lchash → shriftni tanlash → shaxsiy chizma.");
}

main().catch((error) => {
  console.error("USLUB TEKSHIRUVI YIQILDI:", error);
  process.exit(1);
});
