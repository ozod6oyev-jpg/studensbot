/**
 * Daftar Bot — qo'lyozma render dvigateli uchun umumiy tiplar.
 * Bu fayl dvigatelning "shartnomasi": brauzer (Studio) va Node (Telegram bot)
 * bir xil API'dan foydalanadi.
 */

/** Qog'oz turi: yo'l-yo'l (chiziqli), katak daftar yoki toza varaq. */
export type PaperType = "lined" | "grid" | "plain";

/** Siyoh rangi. */
export type InkColor = "blue" | "black" | "graphite" | "green" | "red" | "purple";

/**
 * Qo'lyozma shrifti identifikatori. Kutubxonadagi har bir shrift o'z id'siga
 * ega (masalan "caveat", "badscript", "dancingscript") — to'liq ro'yxat
 * `fonts.generated.ts` faylida.
 */
export type FontId = string;

/**
 * Varaq formati. `strip` — kichik namuna varaqasi (masalan, shrift
 * galereyasidagi plitkalar uchun): tez chiziladi va UI'dagi format
 * ro'yxatida ko'rsatilmaydi.
 */
export type PageFormat = "a4" | "a5" | "square" | "strip";

export interface NotebookStyle {
  paper: PaperType;
  ink: InkColor;
  font: FontId;
  /** Asosiy shrift o'lchami (pikselda, 150 dpi varaq uchun). */
  fontSize: number;
  /** Chiziqlar orasidagi masofa (piksel). */
  lineGap: number;
  /** Chap chegara kengligi (piksel). */
  marginLeft: number;
  /** Qizil chegara chizig'i ko'rsatilsinmi. */
  marginLine: boolean;
  /** Qo'lyozma "tartibsizligi": 0 — tekis, 1 — juda jonli. */
  wobble: number;
  /** Tasodifiy sonlar generatori uchun urug' — natija takrorlanadigan bo'ladi. */
  seed: number;
  /** Matematika rejimi: ^, _, \frac{}{}, \sqrt{} kabi yozuvlar tahlil qilinadi. */
  mathMode: boolean;
  pageFormat: PageFormat;
}

export const DEFAULT_STYLE: NotebookStyle = {
  paper: "lined",
  ink: "blue",
  font: "caveat",
  fontSize: 34,
  lineGap: 56,
  marginLeft: 120,
  marginLine: true,
  wobble: 0.55,
  seed: 7,
  mathMode: true,
  pageFormat: "a4",
};

export interface RenderPage {
  /** 1 dan boshlanadigan varaq raqami. */
  index: number;
  total: number;
  width: number;
  height: number;
  /** PNG fayl baytlari. */
  png: Uint8Array;
  /** Xom RGBA piksellar (asosan test/tekshirish uchun). */
  rgba: Uint8ClampedArray;
}

export interface RenderResult {
  pages: RenderPage[];
  /** Foydalanuvchiga ko'rsatiladigan ogohlantirishlar (masalan, topilmagan belgilar). */
  warnings: string[];
}

export interface RenderInput {
  text: string;
  style?: Partial<NotebookStyle>;
  /**
   * Shrift baytlari. Brauzerda `renderNotebookInBrowser`, Node'da bot ularni
   * o'zi o'qib beradi. Berilmasa, standart shrift yuklanmagan bo'ladi va
   * funksiya xato qaytaradi.
   */
  fonts?: Partial<Record<FontId, Uint8Array | ArrayBuffer>>;
}

/* ------------------------------------------------------------------ */
/* Matematik belgilar kutubxonasi uchun tiplar (symbols.ts)            */
/* ------------------------------------------------------------------ */

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * Bitta qalam harakati. Koordinatalar "em" qutisida beriladi:
 *  - x: 0 (belgi boshi) → 1 (belgi oxiri), ya'ni advance kengligiga nisbatan;
 *  - y: 0 — asosiy chiziq (baseline), musbat qiymat yuqoriga.
 * Kichik harflar balandligi ≈ 0.5, katta harflar ≈ 0.7.
 */
export interface StrokePath {
  points: StrokePoint[];
  /** Qalam uchi qalinligi (em birligida), standart 0.075. */
  width?: number;
  closed?: boolean;
}

export interface SymbolDef {
  /** Belgining kengligi (em birligida), standart 0.62. */
  advance: number;
  /** Chiziladigan qalam harakatlari tartibi. */
  strokes: StrokePath[];
}

/* ------------------------------------------------------------------ */
/* Ichki tiplar (dvigatel fayllari orasida)                            */
/* ------------------------------------------------------------------ */

export interface Vec2 {
  x: number;
  y: number;
}

/** Rasterlash uchun tekislangan poligon (yopiq kontur). */
export type Contour = Vec2[];

/** Joylashuv natijasi: sahifadagi bitta chiziladigan element. */
export interface InkShape {
  contours: Contour[];
}

/**
 * Chizish uchun "qog'oz usti" interfeysi: joylashuv (layout) va matematika
 * moduli shu interfeys orqali chizadi, rasterlashni esa render.ts bajaradi.
 * Shu tufayli jitter (qo'l tebranishi) va siyoh kuchi yagona joyda qo'llanadi.
 */
export interface InkSink {
  /** Bitta belgini chizadi (shriftda bo'lsa), aks holda matematik belgi bilan. */
  glyph(ch: string, x: number, baseline: number, size: number, alpha: number): void;
  /** Qalam harakatlari bilan chiziladigan matematik belgi. */
  symbol(ch: string, x: number, baseline: number, size: number, alpha: number): void;
  /** Qo'lda berilgan qalam harakatlari (masalan, ildiz "tirqishi"). */
  strokes(strokes: StrokePath[], x: number, baseline: number, size: number, alpha: number): void;
  /** Yupqa to'g'ri chiziq (kasr chizig'i, ustki chiziq). */
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, alpha: number): void;
}

/** Matn qatoridagi eng kichik joylashtiriladigan bo'lak (so'z, bo'shliq yoki formula). */
export interface Atom {
  width: number;
  /** Asosiy chiziqdan yuqoriga balandligi (piksel). */
  ascent: number;
  /** Asosiy chiziqdan pastga chuqurligi (piksel). */
  descent: number;
  render(sink: InkSink, x: number, baseline: number, alpha: number): void;
}
