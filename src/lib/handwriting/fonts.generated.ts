// AVTOMATIK ISHLAB CHIQARILGAN FAYL — qo'lda tahrirlamang.
// Yangilash: bun run fonts:fetch
//
// Har bir yozuv google/fonts repozitoriyasidan yuklab olingan qo'lyozma
// shriftini tasvirlaydi: qaysi belgilarni qamrab olishi, x-balandligi va
// shunga mos o'lcham koeffitsienti (shriftlar bir xil ko'rinishda bo'lishi uchun).

export type FontCategory = "bolalar" | "bosma" | "brus" | "erkin" | "kursiv" | "ozoda";

export interface FontLibraryEntry {
  /** Dvigatelda ishlatiladigan identifikator (masalan "caveat"). */
  id: string;
  /** UI va botda ko'rsatiladigan nom. */
  label: string;
  /** Shriftning haqiqiy oilaviy nomi. */
  family: string;
  /** `src/assets/fonts/` ichidagi fayl nomi. */
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
  /** Litsenziya fayli (`src/assets/fonts/licenses/`). */
  license: string;
}

/** Chizish uchun yetim belgi qolsa ishlatiladigan zaxira shrift. */
export const FALLBACK_FONT_ID = "caveat";

export const FONT_LIBRARY: FontLibraryEntry[] = [
  { id: "indieflower", label: "Indie Flower — bolalar yozuvi", family: "Indie Flower", file: "IndieFlower-Regular.ttf", category: "bolalar", cyrillic: false, latin: true, mathScore: 32, sizeScale: 0.861, inkDensity: 0.0542, license: "indieflower.txt" },
  { id: "pangolin", label: "Pangolin — bolalar yozuvi", family: "Pangolin", file: "Pangolin-Regular.ttf", category: "bolalar", cyrillic: true, latin: true, mathScore: 52, sizeScale: 0.75, inkDensity: 0.121, license: "pangolin.txt" },
  { id: "architectsdaughter", label: "Architects Daughter — texnik yozuv", family: "Architects Daughter", file: "ArchitectsDaughter-Regular.ttf", category: "bosma", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.0816, license: "architectsdaughter.txt" },
  { id: "marmelad", label: "Marmelad — yumaloq yozuv", family: "Marmelad", file: "Marmelad-Regular.ttf", category: "bosma", cyrillic: true, latin: true, mathScore: 32, sizeScale: 0.75, inkDensity: 0.11, license: "marmelad.txt" },
  { id: "neucha", label: "Neucha — bosma qo'lyozma", family: "Neucha", file: "Neucha.ttf", category: "bosma", cyrillic: true, latin: true, mathScore: 12, sizeScale: 0.75, inkDensity: 0.0797, license: "neucha.txt" },
  { id: "patrickhand", label: "Patrick Hand — o'quvchi yozuvi", family: "Patrick Hand", file: "PatrickHand-Regular.ttf", category: "bosma", cyrillic: false, latin: true, mathScore: 60, sizeScale: 0.75, inkDensity: 0.0861, license: "patrickhand.txt" },
  { id: "patrickhandsc", label: "Patrick Hand SC — yirik yozuv", family: "Patrick Hand SC", file: "PatrickHandSC-Regular.ttf", category: "bosma", cyrillic: false, latin: true, mathScore: 60, sizeScale: 0.75, inkDensity: 0.085, license: "patrickhandsc.txt" },
  { id: "underdog", label: "Underdog — keng yozuv", family: "Underdog", file: "Underdog-Regular.ttf", category: "bosma", cyrillic: true, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.1101, license: "underdog.txt" },
  { id: "amaticsc", label: "Amatic SC — ingichka baland yozuv", family: "Amatic SC", file: "AmaticSC-Regular.ttf", category: "brus", cyrillic: true, latin: true, mathScore: 56, sizeScale: 0.75, inkDensity: 0.0559, license: "amaticsc.txt" },
  { id: "caveatbrush", label: "Caveat Brush — bo'r yozuvi", family: "Caveat Brush", file: "CaveatBrush-Regular.ttf", category: "brus", cyrillic: false, latin: true, mathScore: 60, sizeScale: 0.825, inkDensity: 0.1009, license: "caveatbrush.txt" },
  { id: "comforter", label: "Comforter — mo'yqalam yozuvi", family: "Comforter", file: "Comforter-Regular.ttf", category: "brus", cyrillic: true, latin: true, mathScore: 56, sizeScale: 0.75, inkDensity: 0.0528, license: "comforter.txt" },
  { id: "lobster", label: "Lobster — bosilgan yozuv", family: "Lobster", file: "Lobster-Regular.ttf", category: "brus", cyrillic: true, latin: true, mathScore: 60, sizeScale: 0.75, inkDensity: 0.1587, license: "lobster.txt" },
  { id: "lobstertwo", label: "Lobster Two — bosma kursiv", family: "Lobster Two", file: "LobsterTwo-Regular.ttf", category: "brus", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.1186, license: "lobstertwo.txt" },
  { id: "pacifico", label: "Pacifico — erkin kursiv", family: "Pacifico", file: "Pacifico-Regular.ttf", category: "brus", cyrillic: true, latin: true, mathScore: 56, sizeScale: 0.75, inkDensity: 0.1548, license: "pacifico.txt" },
  { id: "caveat", label: "Caveat — erkin qo'lyozma", family: "Caveat", file: "Caveat[wght].ttf", category: "erkin", cyrillic: true, latin: true, mathScore: 36, sizeScale: 0.966, inkDensity: 0.0478, license: "caveat.txt" },
  { id: "coveredbyyourgrace", label: "Covered By Your Grace — kichik yozuv", family: "Covered By Your Grace", file: "CoveredByYourGrace.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.0988, license: "coveredbyyourgrace.txt" },
  { id: "gloriahallelujah", label: "Gloria Hallelujah — yumshoq yozuv", family: "Gloria Hallelujah", file: "GloriaHallelujah.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.0966, license: "gloriahallelujah.txt" },
  { id: "kalam", label: "Kalam — tez yozuv", family: "Kalam", file: "Kalam-Regular.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 56, sizeScale: 0.75, inkDensity: 0.1063, license: "kalam.txt" },
  { id: "mansalva", label: "Mansalva — qalin qo'lyozma", family: "Mansalva", file: "Mansalva-Regular.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 84, sizeScale: 0.901, inkDensity: 0.092, license: "mansalva.txt" },
  { id: "nothingyoucoulddo", label: "Nothing You Could Do — beparvo yozuv", family: "Nothing You Could Do", file: "NothingYouCouldDo.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.836, inkDensity: 0.0541, license: "nothingyoucoulddo.txt" },
  { id: "reeniebeanie", label: "Reenie Beanie — bemalol yozuv", family: "Reenie Beanie", file: "ReenieBeanie.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 60, sizeScale: 0.833, inkDensity: 0.0321, license: "reeniebeanie.txt" },
  { id: "shadowsintolight", label: "Shadows Into Light — yengil yozuv", family: "Shadows Into Light", file: "ShadowsIntoLight.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.0927, license: "shadowsintolight.txt" },
  { id: "shadowsintolighttwo", label: "Shadows Into Light Two — ingichka yozuv", family: "Shadows Into Light Two", file: "ShadowsIntoLightTwo-Regular.ttf", category: "erkin", cyrillic: false, latin: true, mathScore: 20, sizeScale: 0.75, inkDensity: 0.097, license: "shadowsintolighttwo.txt" },
  { id: "allura", label: "Allura — silliq kursiv", family: "Allura", file: "Allura-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 56, sizeScale: 1.13, inkDensity: 0.0448, license: "allura.txt" },
  { id: "dancingscript", label: "Dancing Script — jonli kursiv", family: "Dancing Script", file: "DancingScript[wght].ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 32, sizeScale: 1.024, inkDensity: 0.0542, license: "dancingscript.txt" },
  { id: "eaglelake", label: "Eagle Lake — gotika yozuvi", family: "Eagle Lake", file: "EagleLake-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 28, sizeScale: 0.75, inkDensity: 0.1499, license: "eaglelake.txt" },
  { id: "engagement", label: "Engagement — to'y kursivi", family: "Engagement", file: "Engagement-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 40, sizeScale: 1.112, inkDensity: 0.0561, license: "engagement.txt" },
  { id: "greatvibes", label: "Great Vibes — hashamatli kursiv", family: "Great Vibes", file: "GreatVibes-Regular.ttf", category: "kursiv", cyrillic: true, latin: true, mathScore: 60, sizeScale: 0.952, inkDensity: 0.0496, license: "greatvibes.txt" },
  { id: "italianno", label: "Italianno — vertikal kursiv", family: "Italianno", file: "Italianno-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 56, sizeScale: 1.285, inkDensity: 0.0348, license: "italianno.txt" },
  { id: "monsieurladoulaise", label: "Monsieur La Doulaise — klassik kursiv", family: "Monsieur La Doulaise", file: "MonsieurLaDoulaise-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 24, sizeScale: 1.4, inkDensity: 0.0252, license: "monsieurladoulaise.txt" },
  { id: "mrdehaviland", label: "Mr De Haviland — sovuq kursiv", family: "Mr De Haviland", file: "MrDeHaviland-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 24, sizeScale: 1.4, inkDensity: 0.0202, license: "mrdehaviland.txt" },
  { id: "parisienne", label: "Parisienne — parijcha kursiv", family: "Parisienne", file: "Parisienne-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 36, sizeScale: 0.963, inkDensity: 0.0569, license: "parisienne.txt" },
  { id: "petitformalscript", label: "Petit Formal Script — nafis kursiv", family: "Petit Formal Script", file: "PetitFormalScript-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 36, sizeScale: 0.75, inkDensity: 0.0951, license: "petitformalscript.txt" },
  { id: "ruthie", label: "Ruthie — kayfiyatli kursiv", family: "Ruthie", file: "Ruthie-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 56, sizeScale: 1.09, inkDensity: 0.0301, license: "ruthie.txt" },
  { id: "sacramento", label: "Sacramento — yupqa kursiv", family: "Sacramento", file: "Sacramento-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 44, sizeScale: 1.111, inkDensity: 0.0392, license: "sacramento.txt" },
  { id: "tangerine", label: "Tangerine — yupqa kursiv", family: "Tangerine", file: "Tangerine-Regular.ttf", category: "kursiv", cyrillic: false, latin: true, mathScore: 20, sizeScale: 1.333, inkDensity: 0.0226, license: "tangerine.txt" },
  { id: "yesevaone", label: "Yeseva One — tantanali kursiv", family: "Yeseva One", file: "YesevaOne-Regular.ttf", category: "kursiv", cyrillic: true, latin: true, mathScore: 16, sizeScale: 0.75, inkDensity: 0.1666, license: "yesevaone.txt" },
  { id: "badscript", label: "Bad Script — ingichka yozuv", family: "Bad Script", file: "BadScript-Regular.ttf", category: "ozoda", cyrillic: true, latin: true, mathScore: 32, sizeScale: 0.75, inkDensity: 0.066, license: "badscript.txt" },
  { id: "marckscript", label: "Marck Script — ozoda yozuv", family: "Marck Script", file: "MarckScript-Regular.ttf", category: "ozoda", cyrillic: true, latin: true, mathScore: 28, sizeScale: 0.914, inkDensity: 0.0713, license: "marckscript.txt" },
];

export function fontEntry(id: string): FontLibraryEntry | undefined {
  return FONT_LIBRARY.find((entry) => entry.id === id);
}

/** Shrift topilmasa yoki zaxira kerak bo'lsa ishlatiladi. */
export function fallbackEntry(): FontLibraryEntry {
  return fontEntry(FALLBACK_FONT_ID) ?? FONT_LIBRARY[0];
}
