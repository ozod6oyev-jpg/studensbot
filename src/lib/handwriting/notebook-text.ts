/**
 * Daftar matni ustida ishlash: qatorlar/so'zlar bo'yicha o'lchash va tahrirlash.
 *
 * Bot foydalanuvchiga "qayerdan yozishni" va "qayerni o'chirishni" taklif
 * qilganda aynan **chizilgan varaqadagi** qatorlarni sanashi kerak. Shu sababli
 * matn qatorlarga `layoutText()` orqali bo'linadi (har bir so'z alohida atom,
 * bo'sh qator ham qator sifatida saqlanadi) — ya'ni bu yerdagi raqamlar rasmda
 * ko'ringan qatorlar bilan bir xil bo'ladi.
 *
 * Matn modeli oddiy: har bir bet (side) — bu qator uzilishlari aniq saqlangan
 * matn. Bo'sh qatorlar `\n` bilan ifodalanadi, shuning uchun "5-qatordan
 * yozish" = matn boshiga 4 ta `\n` qo'yish.
 */
import { fontHas, glyphAdvance, type HandwritingFont } from "./font";
import { layoutText, linesPerPageFor } from "./layout";
import type { NotebookStyle } from "./types";

/** Matndagi bitta so'z va undan oldingi ajratgichdagi qator uzilishlari soni. */
export interface TextToken {
  word: string;
  /** Shu so'zdan oldin nechta qator uzilishi (`\n`) bor edi. */
  newlinesBefore: number;
}

export interface SideLine {
  /** 1 dan boshlanadigan qator raqami. */
  index: number;
  words: string[];
  /** Shu qatordagi birinchi so'zning umumiy indeksi (0 dan boshlanadi). */
  wordStart: number;
}

export interface SideTextMeasure {
  lines: SideLine[];
  /** Barcha so'zlar ketma-ket (qatorlarga bo'linmagan holda). */
  words: string[];
  /** Bir betga sig'adigan qatorlar soni (joriy uslub bo'yicha). */
  linesPerPage: number;
  /** Matn nechta betga joylashdi. */
  pages: number;
  /** Oxirgi betning tepasidan sanaganda bo'sh qolgan qatorlar. */
  freeLines: number;
}

/** Matn so'zlarini ajratadi (bo'shliq turlari, qator uzilishlari). */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/** Matnni so'zlar va ular oldidagi qator uzilishlariga bo'ladi. */
export function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let newlines = 0;
  let word = "";
  let started = false;

  const flush = () => {
    if (!started || word.length === 0) return;
    tokens.push({ word, newlinesBefore: tokens.length === 0 ? 0 : newlines });
    word = "";
    started = false;
    newlines = 0;
  };

  for (const ch of text.replace(/\r\n?/g, "\n")) {
    if (ch === "\n") {
      flush();
      newlines += 1;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }
    if (!started) {
      started = true;
      word = ch;
      continue;
    }
    word += ch;
  }
  flush();
  return tokens;
}

/** Tokenlarni matnga qaytaradi (qator uzilishlari saqlanadi). */
export function tokensToText(tokens: TextToken[]): string {
  let text = "";
  tokens.forEach((token, index) => {
    if (index > 0) {
      text += token.newlinesBefore > 0 ? "\n".repeat(token.newlinesBefore) : " ";
    } else if (token.newlinesBefore > 0) {
      text += "\n".repeat(token.newlinesBefore);
    }
    text += token.word;
  });
  return text;
}

/** Namuna matnini uslub bo'yicha qatorlarga bo'ladi va so'zlarni bog'laydi. */
export function measureSideText(input: {
  text: string;
  style: NotebookStyle;
  primary: HandwritingFont;
  secondary?: HandwritingFont;
  sizeScale?: number;
}): SideTextMeasure {
  const words = wordsOf(input.text);
  const linesPerPage = linesPerPageFor(input.style.pageFormat, input.style.lineGap);
  const layout = layoutText({
    text: input.text,
    style: input.style,
    primary: input.primary,
    secondary: input.secondary,
    sizeScale: input.sizeScale,
  });

  const lines: SideLine[] = [];
  let cursor = 0;
  const flat = layout.lines;

  for (let index = 0; index < flat.length; index += 1) {
    const count = flat[index].words;
    const from = cursor;
    cursor = Math.min(words.length, cursor + count);
    lines.push({ index: index + 1, words: words.slice(from, cursor), wordStart: from });
  }
  // Matematik belgilar yoki kesilgan so'zlar hisobiga farq bo'lsa, qolgan
  // so'zlarni oxirgi qatorga qo'shamiz (o'lchov baribir ishlatiladi).
  if (cursor < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    last.words = words.slice(last.wordStart);
  }

  const pages = Math.max(0, Math.ceil(lines.length / linesPerPage));
  const usedOnLastPage = lines.length === 0 ? 0 : lines.length % linesPerPage === 0 ? linesPerPage : lines.length % linesPerPage;

  return {
    lines,
    words,
    linesPerPage,
    pages,
    freeLines: lines.length === 0 ? linesPerPage : linesPerPage - usedOnLastPage,
  };
}

/**
 * Betga yangi matn qo'shadi: yangi so'zlar aynan `startLine`-qatordan
 * boshlanadi (1 dan sanaladi), oradagi qatorlar bo'sh qoladi.
 */
export function appendChunk(text: string, chunk: string, startLine: number): string {
  const body = chunk.trim();
  if (body.length === 0) return text;

  const existing = measureLineCount(text);
  if (existing === 0) {
    const blank = Math.max(0, startLine - 1);
    return `${"\n".repeat(blank)}${body}`;
  }
  // Yangi matn yangi qatordan boshlanadi; `startLine` undan keyin bo'lsa,
  // oradagi qatorlar bo'sh qoladi.
  const gap = Math.max(1, startLine - existing);
  return `${text}${"\n".repeat(gap)}${body}`;
}

/** Matn nechta qatorni egallaydi (bo'sh qatorlar ham hisobga olinadi). */
export function measureLineCount(text: string): number {
  if (text.trim().length === 0) return text.includes("\n") ? text.split("\n").length - 1 : 0;
  return text.replace(/\r\n?/g, "\n").split("\n").length;
}

/**
 * So'zlarni `from`-so'zdan `to`-so'zgacha (ikkalasi ham ichida) o'chiradi.
 * Ajratgichlar saqlanadi: shu sababli o'chirilmagan qismning qator tuzilishi
 * o'zgarmaydi.
 */
export function deleteWordRange(text: string, from: number, to: number): { text: string; removed: string } {
  const tokens = tokenizeText(text);
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(tokens.length - 1, Math.max(from, to));
  if (tokens.length === 0 || start > end) return { text, removed: "" };

  const removed = tokensToText(
    tokens.slice(start, end + 1).map((token, index) => ({
      word: token.word,
      newlinesBefore: index === 0 ? 0 : token.newlinesBefore,
    })),
  );
  const kept = [...tokens.slice(0, start), ...tokens.slice(end + 1)];
  if (kept.length > 0 && start > 0) {
    // O'chirilgan oraliqning boshidagi ajratgich saqlanadi (qator tuzilishi
    // o'zgarmasin): oldingi so'zning ajratgichi o'z holida qoladi.
    kept[0] = { ...kept[0], newlinesBefore: tokens[start].newlinesBefore };
  }
  return { text: tokensToText(kept), removed };
}

/** Shrift qator uzilishlarini hisoblashda ishlatiladi (bo'shliq kengligi). */
export function spaceWidthOf(font: HandwritingFont, size: number): number {
  return (fontHas(font, " ") ? glyphAdvance(font, " ") : 0.26) * size;
}
