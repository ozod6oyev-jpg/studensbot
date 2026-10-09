/**
 * Studio uchun tayyor matn namunalari va matematika yozuvi yordami.
 *
 * Bu qiymatlar ikki joyda kerak: brauzerdagi Studio (`src/pages/Studio.tsx`) va
 * Telegram Mini App studiyasi (`src/components/mini-app-studio.tsx`). Ikkalasi
 * bir xil namuna va bir xil qo'llanmani ko'rsatishi uchun matnlar shu yerda —
 * bir nusxada — saqlanadi.
 */

export const SAMPLE_LITERATURE = [
  "Vatan haqida",
  "",
  "Vatan — bu faqat tuproq emas, u — bolaligim, onamning ovozi, tonggi shabada.",
  "Ko'ngil qaysi yurtda bo'lmasin, vatan o'sha yerda boshlanadi.",
  "",
  "A. Oripov",
].join("\n");

export const SAMPLE_MATH = [
  "Mavzu: Kvadrat tenglama",
  "",
  "x^2 - 5x + 6 = 0",
  "D = b^2 - 4ac = 25 - 24 = 1",
  "",
  "x_1 = \\frac{5 + 1}{2} = 3",
  "",
  "x_2 = \\frac{5 - 1}{2} = 2",
  "",
  "Javob: x_1 = 3, x_2 = 2",
].join("\n");

export interface MathHelpEntry {
  /** Daftarga yoziladigan belgi (chizuvchi uni matematik shaklda chizadi). */
  syntax: string;
  /** Shu belgi nimani anglatishi. */
  text: string;
}

export const MATH_HELP: MathHelpEntry[] = [
  { syntax: "x^2", text: "yuqori indeks — daraja (kvadrat, kub va boshqalar)" },
  { syntax: "a_1", text: "pastki indeks — element raqami, indeks" },
  { syntax: "\\frac{a}{b}", text: "kasr — surat tepada, maxraj pastda, chiziq bilan" },
  { syntax: "\\sqrt{x}", text: "ildiz belgisi bilan o'ralgan ifoda" },
];

/**
 * Mini App studiyasidagi tez tugmalar: matn maydoniga kursordan qo'shiladi.
 * Faqat chizuvchi haqiqatan qo'llaydigan belgilar — ro'yxat `MATH_HELP` bilan
 * bir xil manbadan.
 */
export const MATH_SNIPPETS: string[] = ["^2", "_1", "\\frac{a}{b}", "\\sqrt{x}"];
