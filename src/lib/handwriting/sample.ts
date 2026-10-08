/**
 * Foydalanuvchi namunaviy qo'lyozmasini o'lchash.
 *
 * Bot foydalanuvchidan yo'l-yo'l daftarda 10 ta so'z yozib, rasm qilib
 * yuborishni so'raydi; shu rasmdan yozuv uslubining **o'lchovlari** olinadi:
 * qiyalik, shtrix qalinligi, x-balandlik, harflar orasidagi masofa, satr
 * asosining beqarorligi va siyoh quyuqligi. Bu o'lchovlar keyin eng yaqin
 * shriftni tanlash va uni foydalanuvchining qo'liga moslash uchun ishlatiladi.
 *
 * Bu modul faqat matematika va massivlar bilan ishlaydi (dvigatelga bog'liq
 * emas), shuning uchun uni sinash oson: ma'lum qiyalik bilan chizilgan varaqni
 * o'lchab, natijani taqqoslash mumkin.
 */

/** RGBA rasm (masalan, JPEG'dan ochilgan yoki dvigatel chizgan varaqa). */
export interface SampleImage {
  width: number;
  height: number;
  /** RGBA baytlari: 4 bayt piksel (0–255). */
  data: Uint8ClampedArray | Uint8Array;
}

export interface SampleProfile {
  /** Topilgan matn satrlari soni. */
  lines: number;
  /** Siyoh piksellari soni (sifat nazorati uchun). */
  inkPixels: number;
  /** Qiyalik, gradusda (musbat — o'ngga). */
  slant: number;
  /** Shtrix qalinligi / satr balandligi. */
  thickness: number;
  /** x-balandlik / satr balandligi. */
  xHeight: number;
  /** Satr kengligida siyohli ustunlar ulushi (yozuvning zichligi). */
  coverage: number;
  /**
   * Harf shakli nisbati: bo'lak kengligi / balandligi (mediana). Cho'zilgan
   * yozuvda harflar kengroq bo'ladi, shuning uchun bu o'lchov "kenglik"
   * tuzatmasini aniqlaydi.
   */
  aspect: number;
  /**
   * Harflar orasidagi o'rtacha masofa / x-balandlik. x-balandlikka nisbatan
   * olingani uchun bu o'lchov shtrix qalinligiga deyarli bog'liq emas.
   */
  tracking: number;
  /** Satr asosining beqarorligi (MAD / satr balandligi). */
  wobble: number;
  /** Siyoh quyuqligi (0–1: 1 — qora). */
  density: number;
}

export interface SampleQuality {
  ok: boolean;
  reason?: string;
}

/**
 * Namuna yaroqliligini tekshirish shartlari.
 *
 * `minInk` — eng kam siyoh piksellari. Kichik namunada (masalan, katak
 * varaqadagi 10 ta raqamda) siyoh kam bo'ladi, shuning uchun bu chegara
 * qadamga qarab pasaytiriladi.
 */
export interface SampleQualityOptions {
  minLines?: number;
  minInk?: number;
}

/* * Otsu chegarasi: gistogrammani eng yaxshi ajratadigan yorqinlik. */
function otsuThreshold(histogram: Uint32Array, total: number): number {
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let best = 0;
  let bestVariance = -1;
  let weightBackground = 0;
  let sumBackground = 0;
  for (let value = 0; value < 256; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > bestVariance) {
      bestVariance = between;
      best = value;
    }
  }
  return best;
}

/** Median (kirish massiv saralanadi). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

/** O'rtacha mutlaq og'ish (MAD) — chet qiymatlarga chidamli o'lchov. */
function mad(values: number[], center: number): number {
  if (values.length === 0) return 0;
  return median(values.map((value) => Math.abs(value - center)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface InkMask {
  width: number;
  height: number;
  /** 1 — siyoh, 0 — qog'oz. */
  mask: Uint8Array;
  /** Siyoh piksellarining koordinatalari. */
  xs: Int32Array;
  ys: Int32Array;
  count: number;
}

/** Rasmni "siyoh/qog'oz" ga ajratadi (Otsu chegarasi bilan). */
export function inkMaskOf(image: SampleImage): InkMask {
  const { width, height, data } = image;
  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);

  for (let index = 0, at = 0; index < luminance.length; index += 1, at += 4) {
    // Fon shaffof bo'lsa (masalan, PNG alfa), uni qog'oz deb hisoblaymiz.
    const alpha = data[at + 3];
    const value =
      alpha < 16
        ? 255
        : Math.round(0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]);
    luminance[index] = value;
    histogram[value] += 1;
  }

  const threshold = otsuThreshold(histogram, width * height);
  // Qog'oz yorqinligini o'rtacha emas, gistogrammaning **yuqori ulushi**
  // bo'yicha olamiz: chiziqli yoki katak varaqada o'rtacha qiymat chiziqlar
  // hisobiga pasayib ketadi va siyoh chegarasi juda past bo'lib qoladi (chiziqlar
  // ham "siyoh" bo'lib sanaladi).
  let seen = 0;
  let paper = 255;
  for (let value = 255; value >= 0; value -= 1) {
    seen += histogram[value];
    if (seen >= width * height * 0.1) {
      paper = value;
      break;
    }
  }
  const inkThreshold = Math.min(threshold, Math.max(0, paper - 40));

  const mask = new Uint8Array(width * height);
  let count = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    if (luminance[index] < inkThreshold) {
      mask[index] = 1;
      count += 1;
    }
  }

  // Daftar chizig'i va katagi siyoh deb o'qilmasligi kerak: aks holda satrlar
  // soni ham, qiyalik ham noto'g'ri chiqadi (foydalanuvchi suratlari doim
  // chiziqli yoki katak varaqda bo'ladi).
  count -= stripRuledLines(mask, width, height);

  const xs = new Int32Array(count);
  const ys = new Int32Array(count);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 1) {
        xs[at] = x;
        ys[at] = y;
        at += 1;
      }
    }
  }

  return { width, height, mask, xs, ys, count };
}

/**
 * Varaqadagi ingichka uzun chiziqlarni (daftar chizig'i, katak chegarasi)
 * o'chiradi va o'chirilgan piksel sonini qaytaradi.
 *
 * Chiziq belgisi: qator (yoki ustun) siyohga deyarli to'la, ammo chiziq
 * **yupqa** — ya'ni kesib o'tgan harf shtrixlaridan farq qiladi. Shu sababli
 * qalin joylar (harflar) saqlanib qoladi, faqat yupqa chiziqlar o'chadi.
 */
function stripRuledLines(mask: Uint8Array, width: number, height: number): number {
  let removed = 0;
  const wideFraction = 0.4;
  const minWide = 40;

  // Gorizontal chiziqlar (yo'l-yo'l daftar, katakning gorizontal tomoni).
  const rowInk = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += mask[y * width + x];
    rowInk[y] = count;
  }
  for (let y = 0; y < height; y += 1) {
    if (rowInk[y] < Math.max(minWide, width * wideFraction)) continue;
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 1) {
        mask[y * width + x] = 0;
        removed += 1;
      }
    }
  }

  // Vertikal chiziqlar (katak daftar, qizil chegara).
  const columnInk = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) count += mask[y * width + x];
    columnInk[x] = count;
  }
  for (let x = 0; x < width; x += 1) {
    if (columnInk[x] < Math.max(minWide, height * wideFraction)) continue;
    for (let y = 0; y < height; y += 1) {
      if (mask[y * width + x] === 1) {
        mask[y * width + x] = 0;
        removed += 1;
      }
    }
  }

  return removed;
}

interface Line {
  top: number;
  bottom: number;
  /** Ustun bo'yicha eng past siyoh pikseli (asosiy chiziq bahosi). */
  baselines: number[];
  /** Ustun bo'yicha eng yuqori siyoh pikseli. */
  tops: number[];
}

/** Satrlarni gorizontal proyeksiya bo'yicha topadi. */
function findLines(mask: InkMask): Line[] {
  const { width, height, mask: pixels } = mask;
  const rowInk = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) count += pixels[y * width + x];
    rowInk[y] = count;
  }

  const minRowInk = Math.max(3, Math.round(width * 0.004));
  const ranges: { top: number; bottom: number }[] = [];
  let start = -1;
  let gap = 0;
  const maxGap = Math.max(2, Math.round(height * 0.012));

  for (let y = 0; y < height; y += 1) {
    if (rowInk[y] >= minRowInk) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap > maxGap) {
        ranges.push({ top: start, bottom: y - gap });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) ranges.push({ top: start, bottom: height - 1 });

  const lines: Line[] = [];
  for (const range of ranges) {
    const lineHeight = range.bottom - range.top + 1;
    if (lineHeight < 6) continue;
    let ink = 0;
    for (let y = range.top; y <= range.bottom; y += 1) ink += rowInk[y];
    if (ink < 40) continue;

    const baselines: number[] = [];
    const tops: number[] = [];
    for (let x = 0; x < width; x += 1) {
      let first = -1;
      let last = -1;
      for (let y = range.top; y <= range.bottom; y += 1) {
        if (pixels[y * width + x] === 1) {
          if (first < 0) first = y;
          last = y;
        }
      }
      if (first >= 0) {
        tops.push(first);
        baselines.push(last);
      }
    }
    if (baselines.length < 10) continue;
    lines.push({ top: range.top, bottom: range.bottom, baselines, tops });
  }
  return lines;
}

/**
 * Qiyalikni topadi: siyoh pikselini gorizontal siljitib, ustunlar bo'yicha
 * gistogramma eng "o'tkir" (ya'ni vertikal shtrixlar bir ustunga to'plangan)
 * burchak tanlanadi. Bu matn qiyaligining klassik bahosi.
 */
function estimateSlant(mask: InkMask): number {
  if (mask.count < 50) return 0;

  const sharpness = (angleDeg: number): number => {
    const shift = Math.tan((angleDeg * Math.PI) / 180);
    const centerY = mask.height / 2;
    const bins = new Int32Array(mask.width + 64);
    const offset = 32;
    for (let index = 0; index < mask.count; index += 1) {
      const shifted = Math.round(mask.xs[index] + shift * (mask.ys[index] - centerY)) + offset;
      if (shifted >= 0 && shifted < bins.length) bins[shifted] += 1;
    }
    let sum = 0;
    for (let index = 0; index < bins.length; index += 1) sum += bins[index] * bins[index];
    return sum;
  };

  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -20; angle <= 20; angle += 2.5) {
    const score = sharpness(angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  for (let angle = bestAngle - 2; angle <= bestAngle + 2; angle += 0.5) {
    const score = sharpness(angle);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return Math.round(bestAngle * 10) / 10;
}

/** Satrdagi shtrix qalinligi: gorizontal siyoh bo'laklarining medianasi. */
function lineThickness(mask: InkMask, line: Line): number {
  const { width, mask: pixels } = mask;
  const runs: number[] = [];
  for (let y = line.top; y <= line.bottom; y += 1) {
    let run = 0;
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] === 1) run += 1;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    if (run > 0) runs.push(run);
  }
  return runs.length > 0 ? median(runs) : 0;
}

/** Satrdagi harflar orasidagi masofa: siyoh bo'laklari orasidagi bo'shliqlar. */
function lineTracking(mask: InkMask, line: Line): number {
  const { width, mask: pixels } = mask;
  const gaps: number[] = [];
  for (let y = line.top; y <= line.bottom; y += 1) {
    let gap = 0;
    let seen = false;
    for (let x = 0; x < width; x += 1) {
      if (pixels[y * width + x] === 1) {
        if (gap > 0 && seen) gaps.push(gap);
        gap = 0;
        seen = true;
      } else if (seen) {
        gap += 1;
      }
    }
  }
  return gaps.length > 0 ? median(gaps) : 0;
}

/**
 * Harf shakllarining o'rtacha nisbati (kenglik / balandlik).
 *
 * Satr siyohli ustunlar bo'ylab bo'laklarga bo'linadi (harflar orasidagi
 * bo'shliqlar ajratgich bo'ladi); juda past bo'laklar (nuqta, shtrix) hisobga
 * olinmaydi, chunki ular nisbatni buzadi.
 */
function lineAspect(mask: InkMask, line: Line, thickness: number): number {
  const { width, mask: pixels } = mask;
  const lineHeight = line.bottom - line.top + 1;
  const gapMin = Math.max(2, Math.round(thickness * 1.2));
  const aspects: number[] = [];

  let runStart = -1;
  let gap = 0;
  const flush = (end: number) => {
    if (runStart < 0) return;
    let top = line.bottom;
    let bottom = line.top;
    for (let x = runStart; x <= end; x += 1) {
      for (let y = line.top; y <= line.bottom; y += 1) {
        if (pixels[y * width + x] === 1) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    const height = bottom - top + 1;
    const blobWidth = end - runStart + 1;
    if (height >= lineHeight * 0.32 && blobWidth >= 2) aspects.push(blobWidth / height);
    runStart = -1;
  };

  for (let x = 0; x < width; x += 1) {
    let has = false;
    for (let y = line.top; y <= line.bottom; y += 1) {
      if (pixels[y * width + x] === 1) {
        has = true;
        break;
      }
    }
    if (has) {
      if (runStart < 0) runStart = x;
      gap = 0;
    } else if (runStart >= 0) {
      gap += 1;
      if (gap >= gapMin) {
        flush(x - gap);
        gap = 0;
      }
    }
  }
  flush(width - 1);

  return aspects.length > 0 ? median(aspects) : 0;
}

/** Satr kengligida siyohli ustunlar ulushi. */
function lineCoverage(mask: InkMask, line: Line): number {
  const { width, mask: pixels } = mask;
  let firstColumn = -1;
  let lastColumn = -1;
  let inked = 0;
  for (let x = 0; x < width; x += 1) {
    let has = false;
    for (let y = line.top; y <= line.bottom; y += 1) {
      if (pixels[y * width + x] === 1) {
        has = true;
        break;
      }
    }
    if (has) {
      inked += 1;
      if (firstColumn < 0) firstColumn = x;
      lastColumn = x;
    }
  }
  const span = lastColumn - firstColumn + 1;
  return span > 0 ? inked / span : 0;
}

/**
 * Namunani o'lchaydi. Natija — satrlar bo'yicha median qiymatlar, shuning uchun
 * bitta buzuq satr (masalan, chizilgan chiziq) natijani buzmaydi.
 */
export function analyzeSample(image: SampleImage): SampleProfile {
  const mask = inkMaskOf(image);
  const empty: SampleProfile = {
    lines: 0,
    inkPixels: mask.count,
    slant: 0,
    thickness: 0,
    xHeight: 0,
    coverage: 0,
    aspect: 0,
    tracking: 0,
    wobble: 0,
    density: 0,
  };
  if (mask.count === 0) return empty;

  const lines = findLines(mask);
  if (lines.length === 0) return empty;

  // Siyoh quyuqligi: siyoh piksellarining o'rtacha qorong'iligi.
  let darkness = 0;
  for (let index = 0; index < mask.count; index += 1) {
    const at = (mask.ys[index] * mask.width + mask.xs[index]) * 4;
    const value = (image.data[at] + image.data[at + 1] + image.data[at + 2]) / 3;
    darkness += 1 - value / 255;
  }
  const density = clamp(darkness / mask.count, 0, 1);

  const thicknesses: number[] = [];
  const xHeights: number[] = [];
  const trackings: number[] = [];
  const coverages: number[] = [];
  const aspects: number[] = [];
  const wobbles: number[] = [];

  for (const line of lines) {
    const lineHeight = line.bottom - line.top + 1;
    const baseline = median(line.baselines);
    const thickness = lineThickness(mask, line);
    if (thickness <= 0) continue;

    // x-balandlik: past harflar bandining balandligi (asosdan yuqoriga).
    const xTops = line.tops
      .map((top) => baseline - top)
      .filter((height) => height > lineHeight * 0.1 && height < lineHeight * 0.72);
    const xHeightPixels = xTops.length >= 10 ? median(xTops) : 0;

    thicknesses.push(thickness / lineHeight);
    if (xHeightPixels > 0) xHeights.push(xHeightPixels / lineHeight);
    // Oraliqni x-balandlikka nisbatan o'lchaymiz: shtrix qalinligi o'zgarsa ham
    // harflar orasi bir xil qoladi, shuning uchun qalinlik tuzatmasi bu
    // o'lchovni buzmaydi (aks holda u "oraliq"ni sun'iy toraytirardi).
    const gapPixels = lineTracking(mask, line);
    if (gapPixels > 0) trackings.push(gapPixels / (xHeightPixels > 2 ? xHeightPixels : thickness));
    coverages.push(lineCoverage(mask, line));
    const aspect = lineAspect(mask, line, thickness);
    if (aspect > 0) aspects.push(aspect);
    wobbles.push(mad(line.baselines, baseline) / lineHeight);
  }

  if (thicknesses.length === 0) return empty;

  return {
    lines: lines.length,
    inkPixels: mask.count,
    slant: estimateSlant(mask),
    thickness: median(thicknesses),
    xHeight: xHeights.length > 0 ? median(xHeights) : 0,
    coverage: median(coverages),
    aspect: aspects.length > 0 ? median(aspects) : 0,
    tracking: median(trackings),
    wobble: median(wobbles),
    density,
  };
}

/**
 * Namuna yaroqliligini tekshiradi: juda kam siyoh, juda kam satr yoki
 * o'lchovlar ishonchsiz bo'lsa sabab qaytaradi (foydalanuvchidan qayta
 * so'raladi).
 */
export function sampleQuality(profile: SampleProfile, options: SampleQualityOptions = {}): SampleQuality {
  const minLines = options.minLines ?? 2;
  const minInk = options.minInk ?? 400;
  if (profile.inkPixels < minInk) {
    return { ok: false, reason: "Rasmda yozuv juda kam ko'rinadi — varaqni to'ldiribroq yozib qayta yuboring." };
  }
  if (profile.lines < minLines) {
    return {
      ok: false,
      reason: `Rasmda ${profile.lines} ta satr topildi — kamida ${minLines} satr kerak (10 ta so'zni 3–4 satrga yozing).`,
    };
  }
  if (profile.thickness <= 0 || profile.coverage <= 0) {
    return { ok: false, reason: "Yozuv aniq o'qilmadi — rasm yorug'roq va aniqroq bo'lishi kerak." };
  }
  return { ok: true };
}

/** Ikki namunani birlashtiradi: so'zlar namunasi qiyalik/oraliq, raqamlar — qalinlik/o'lcham uchun ustuvor. */
export function mergeProfiles(words: SampleProfile, digits: SampleProfile | null): SampleProfile {
  if (!digits || digits.lines === 0) return words;
  return {
    lines: words.lines + digits.lines,
    inkPixels: words.inkPixels + digits.inkPixels,
    // Qiyalik va harflar orasi so'zlar namunasida aniqroq (raqamlar tikroq yoziladi).
    slant: words.slant * 0.75 + digits.slant * 0.25,
    // Qalinlik va o'lcham raqamlar namunasida barqarorroq.
    thickness: digits.thickness,
    xHeight: words.xHeight > 0 && digits.xHeight > 0 ? (words.xHeight + digits.xHeight) / 2 : words.xHeight || digits.xHeight,
    coverage: words.coverage > 0 && digits.coverage > 0 ? (words.coverage + digits.coverage) / 2 : words.coverage || digits.coverage,
    aspect: words.aspect > 0 && digits.aspect > 0 ? (words.aspect + digits.aspect) / 2 : words.aspect || digits.aspect,
    tracking: words.tracking,
    wobble: words.wobble * 0.7 + digits.wobble * 0.3,
    density: (words.density + digits.density) / 2,
  };
}
