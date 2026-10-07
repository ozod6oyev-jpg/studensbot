/**
 * Shrift varaqasi — bir nechta shrift nomini o'z shriftida chizib, bitta
 * ingichka PNG rasm qilib beradigan modul.
 *
 * Nega kerak: Telegram matnda shriftlarni ko'rsatmaydi, shuning uchun
 * foydalanuvchiga shriftlar ro'yxatini rasm ko'rinishida yuboramiz — har bir
 * nom o'z qo'lyozmasida yozilgan bo'ladi va tanlash osonlashadi.
 *
 * Har bir qator dvigatelning `strip` (kichik namuna varaqasi) rejimida
 * chiziladi, so'ng faqat matn atrofidagi ingichka tasma bitta umumiy rasmga
 * yig'iladi (natija: 900 px keng, ~60–70 px qatorli ixcham varaqa).
 */
import { FALLBACK_FONT_ID } from "./fonts.generated";
import { fontDisplayName } from "./names";
import { pageSizeFor } from "./options";
import { encodePng } from "./png";
import { renderNotebook } from "./render";
import type { FontId, InkColor, PaperType } from "./types";

export interface FontSheetOptions {
  /** Bitta rasmga sig'adigan qatorlar soni (standart 8). */
  rowsPerSheet?: number;
  /** Qog'oz turi: namuna varaqalari uchun odatda `plain` (standart). */
  paper?: PaperType;
  /** Siyoh rangi (standart — ko'k). */
  ink?: InkColor;
  /** Rasmning eng yuqorisidagi sarlavha (zaxira shriftda chiziladi). */
  title?: string;
}

export interface FontSheet {
  /** Rasmda haqiqatan ko'rsatilgan shriftlar (berilgan tartibda). */
  fonts: FontId[];
  /** Tayyor PNG baytlari. */
  png: Uint8Array;
  width: number;
  height: number;
  /** Shrift rasm ichida nechanchi qatorda (1 dan boshlanadi); topilmasa 0. */
  rowOf(id: FontId): number;
}

/** Varaqa chekkasidagi bo'sh joy: strip qirralarining soyasi kesib tashlanadi. */
const SIDE_MARGIN = 24;
/** Qatorlar orasidagi ajratgich balandligi. */
const ROW_GAP = 3;
const ROW_GAP_RGB: [number, number, number] = [219, 212, 199];
const PAPER_RGB: [number, number, number] = [251, 247, 238];
/** Sarlavha va namuna shrift o'lchamlari. */
const TITLE_FONT_SIZE = 30;
const SAMPLE_FONT_SIZE = 34;
const SAMPLE_LINE_GAP = 60;
/** Nom juda uzun bo'lsa rasm ichida qisqartiriladi (qatorga sig'ishi uchun). */
const MAX_NAME_LENGTH = 26;
/** Biror sababdan hech bir shrift chizilmasa, rasm shu balandlikda bo'ladi. */
const EMPTY_HEIGHT = 90;

interface Strip {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Matn joylashgan qatorning tasma boshlanishi va balandligi. */
  bandTop: number;
  bandHeight: number;
}

interface StripStyle {
  paper: PaperType;
  ink: InkColor;
  fontSize: number;
  lineGap: number;
  wobble: number;
  seed: number;
}

function truncateName(text: string): string {
  return text.length <= MAX_NAME_LENGTH ? text : `${text.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
}

/** Bitta qatorni chizib, matn atrofidagi tasma chegaralarini hisoblaydi. */
async function renderStrip(
  text: string,
  fontId: FontId,
  fonts: Partial<Record<FontId, Uint8Array | ArrayBuffer>>,
  style: StripStyle,
): Promise<Strip | null> {
  const result = await renderNotebook({
    text,
    style: {
      paper: style.paper,
      ink: style.ink,
      font: fontId,
      pageFormat: "strip",
      fontSize: style.fontSize,
      lineGap: style.lineGap,
      marginLeft: 60,
      marginLine: false,
      wobble: style.wobble,
      seed: style.seed,
      mathMode: false,
    },
    fonts,
  });

  const page = result.pages[0];
  if (!page) return null;

  // Tasma chegaralari: layout.ts dagi birinchi qator asosiy chizig'i formulasi
  // bilan bir xil hisoblanadi (92k + lineGap - 3k), so'ng shrift o'lchamiga
  // qarab yuqori/pastki chegara qo'shiladi.
  const k = page.width / 1240;
  const baseline = Math.round(92 * k) + style.lineGap - Math.round(3 * k);
  const bandTop = Math.max(0, baseline - Math.round(style.fontSize * 1.25));
  const bandHeight = Math.max(
    1,
    Math.min(page.height - bandTop, Math.round(style.fontSize * 1.95)),
  );

  return { rgba: page.rgba, width: page.width, height: page.height, bandTop, bandHeight };
}

/**
 * Shriftlar ro'yxatidan ingichka varaqa rasmi yasaydi.
 * Fayli yo'q (yoki o'qilmagan) shriftlar rasmga ham, `fonts` ro'yxatiga ham
 * kirmaydi — shu sababli raqamlar uzluksiz qoladi.
 */
export async function renderFontSheet(
  fontIds: FontId[],
  fonts: Partial<Record<FontId, Uint8Array | ArrayBuffer>>,
  options: FontSheetOptions = {},
): Promise<FontSheet> {
  const rowsPerSheet = Math.max(1, options.rowsPerSheet ?? 8);
  const paper = options.paper ?? "plain";
  const ink = options.ink ?? "blue";
  const requested = Array.from(new Set(fontIds)).slice(0, rowsPerSheet);

  const sampleStyle: StripStyle = {
    paper,
    ink,
    fontSize: SAMPLE_FONT_SIZE,
    lineGap: SAMPLE_LINE_GAP,
    wobble: 0.35,
    seed: 11,
  };

  const bands: Strip[] = [];
  const shown: FontId[] = [];

  if (options.title) {
    const titleStrip = await renderStrip(options.title, FALLBACK_FONT_ID, fonts, {
      ...sampleStyle,
      fontSize: TITLE_FONT_SIZE,
    });
    if (titleStrip) bands.push(titleStrip);
  }

  for (const id of requested) {
    if (!fonts[id]) continue;
    const label = truncateName(`${shown.length + 1}. ${fontDisplayName(id)}`);
    const strip = await renderStrip(label, id, fonts, sampleStyle);
    if (!strip) continue;
    bands.push(strip);
    shown.push(id);
  }

  const stripWidth = bands[0]?.width ?? pageSizeFor("strip").width;
  const width = stripWidth + SIDE_MARGIN * 2;
  const totalBandHeight = bands.reduce((sum, band) => sum + band.bandHeight, 0);
  const height = Math.max(EMPTY_HEIGHT, totalBandHeight + Math.max(0, bands.length - 1) * ROW_GAP);
  const target = new Uint8ClampedArray(width * height * 4);

  // Avval butun varaqani qog'oz rangiga bo'yaymiz (qatorlar orasi ham toza qoladi).
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    target[at] = PAPER_RGB[0];
    target[at + 1] = PAPER_RGB[1];
    target[at + 2] = PAPER_RGB[2];
    target[at + 3] = 255;
  }

  let cursorY = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const copyWidth = Math.min(stripWidth, band.width);

    for (let row = 0; row < band.bandHeight; row += 1) {
      const sourceY = band.bandTop + row;
      if (sourceY >= band.height || cursorY + row >= height) break;
      const sourceRow = sourceY * band.width;
      const targetRow = (cursorY + row) * width;
      for (let x = 0; x < copyWidth; x += 1) {
        const from = (sourceRow + x) * 4;
        const to = (targetRow + SIDE_MARGIN + x) * 4;
        target[to] = band.rgba[from];
        target[to + 1] = band.rgba[from + 1];
        target[to + 2] = band.rgba[from + 2];
        target[to + 3] = 255;
      }
    }
    cursorY += band.bandHeight;

    if (index < bands.length - 1) {
      for (let row = 0; row < ROW_GAP; row += 1) {
        if (cursorY + row >= height) break;
        const targetRow = (cursorY + row) * width;
        for (let x = 0; x < width; x += 1) {
          const at = (targetRow + x) * 4;
          target[at] = ROW_GAP_RGB[0];
          target[at + 1] = ROW_GAP_RGB[1];
          target[at + 2] = ROW_GAP_RGB[2];
          target[at + 3] = 255;
        }
      }
      cursorY += ROW_GAP;
    }
  }

  const png = await encodePng(target, width, height);

  return {
    fonts: shown,
    png,
    width,
    height,
    rowOf(id: FontId): number {
      const position = shown.indexOf(id);
      return position < 0 ? 0 : position + 1;
    },
  };
}
