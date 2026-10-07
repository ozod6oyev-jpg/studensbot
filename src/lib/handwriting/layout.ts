import { fontHas, glyphAdvance, kern, type HandwritingFont } from "./font";
import { parseMathAtom, parseScript, wrapScript, type MathContext, type MathFont } from "./math";
import { pageSizeFor } from "./options";
import { hasSymbol, symbolAdvance } from "./pen";
import type { PaperLayout } from "./paper";
import type { Atom, NotebookStyle } from "./types";

export interface PlacedAtom {
  atom: Atom;
  x: number;
}

export interface LineLayout {
  atoms: PlacedAtom[];
}

export interface PageLayout {
  lines: LineLayout[];
}

export interface LayoutResult {
  pages: PageLayout[];
  warnings: string[];
  paper: PaperLayout;
  /** Birinchi qatorning asosiy chizig'i (baseline) y koordinatasi. */
  firstBaseline: number;
  /** Matn boshlanadigan x koordinatasi. */
  textLeft: number;
}

/** Qo'lyozmada ko'p uchraydigan "bir xil ma'noli" belgilar. */
const ALIASES: Record<string, string> = {
  "\u02bb": "'", // o'zbek tutuq belgisi (oʻ)
  "\u02bc": "'",
  "\u2018": "'",
  "\u2019": "'",
  "\u02be": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u00ab": '"',
  "\u00bb": '"',
  "\u2212": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u00a0": " ",
};

interface ResolvedChar {
  kind: "glyph" | "symbol";
  ch: string;
  font?: HandwritingFont;
}

interface BuildContext {
  primary: HandwritingFont;
  secondary?: HandwritingFont;
  size: number;
  mathMode: boolean;
  warnings: Set<string>;
  math: MathContext;
  spaceAtoms: WeakSet<Atom>;
}

function fontFor(ch: string, ctx: BuildContext): HandwritingFont | undefined {
  if (fontHas(ctx.primary, ch)) return ctx.primary;
  if (ctx.secondary && fontHas(ctx.secondary, ch)) return ctx.secondary;
  return undefined;
}

function resolveChar(ch: string, ctx: BuildContext): ResolvedChar | null {
  const direct = fontFor(ch, ctx);
  if (direct) return { kind: "glyph", ch, font: direct };

  const alias = ALIASES[ch];
  if (alias) {
    const aliased = fontFor(alias, ctx);
    if (aliased) return { kind: "glyph", ch: alias, font: aliased };
    if (hasSymbol(alias)) return { kind: "symbol", ch: alias };
  }

  if (hasSymbol(ch)) return { kind: "symbol", ch };

  ctx.warnings.add(`Shriftda topilmadi: "${ch}"`);
  return null;
}

function advanceOf(resolved: ResolvedChar, ctx: BuildContext): number {
  if (resolved.kind === "glyph" && resolved.font) {
    return glyphAdvance(resolved.font, resolved.ch) * ctx.size;
  }
  return symbolAdvance(resolved.ch) * ctx.size;
}

function makeSpaceAtom(ctx: BuildContext): Atom {
  const widthEm = fontHas(ctx.primary, " ") ? glyphAdvance(ctx.primary, " ") : 0.26;
  const atom: Atom = {
    width: Math.max(widthEm, 0.22) * ctx.size * 1.06,
    ascent: 0,
    descent: 0,
    render() {
      /* bo'shliq chizilmaydi */
    },
  };
  ctx.spaceAtoms.add(atom);
  return atom;
}

function isSpaceAtom(atom: Atom, ctx: BuildContext): boolean {
  return ctx.spaceAtoms.has(atom);
}

/** So'zni bitta atomga aylantiradi: kerning, ikkilamchi shrift, matematik belgi. */
function makeWordAtom(word: string, ctx: BuildContext): Atom | null {
  interface Part extends ResolvedChar {
    x: number;
  }

  const parts: Part[] = [];
  let cursor = 0;
  let previous: ResolvedChar | null = null;

  for (const ch of word) {
    const resolved = resolveChar(ch, ctx);
    if (!resolved) continue;

    // Harflar orasidagi qo'shni juftliklar uchun kerning.
    if (
      previous &&
      previous.kind === "glyph" &&
      resolved.kind === "glyph" &&
      previous.font === resolved.font &&
      previous.font
    ) {
      cursor += kern(previous.font, previous.ch, resolved.ch) * ctx.size;
    }

    parts.push({ ...resolved, x: cursor });
    cursor += advanceOf(resolved, ctx);
    previous = resolved;
  }

  if (parts.length === 0) return null;

  return {
    width: cursor,
    ascent: 0.74 * ctx.size,
    descent: 0.26 * ctx.size,
    render(sink, x, baseline, alpha) {
      for (const part of parts) {
        if (part.kind === "symbol") sink.symbol(part.ch, x + part.x, baseline, ctx.size, alpha);
        else sink.glyph(part.ch, x + part.x, baseline, ctx.size, alpha);
      }
    },
  };
}

/** Paragrafni atomlarga bo'ladi: so'zlar, bo'shliqlar va formulalar. */
function buildAtoms(paragraph: string, ctx: BuildContext): Atom[] {
  const atoms: Atom[] = [];
  let word = "";

  const flushWord = () => {
    if (!word) return;
    const atom = makeWordAtom(word, ctx);
    if (atom) atoms.push(atom);
    word = "";
  };

  const pushSpace = () => {
    const last = atoms[atoms.length - 1];
    if (!last || isSpaceAtom(last, ctx)) return;
    atoms.push(makeSpaceAtom(ctx));
  };

  let i = 0;
  while (i < paragraph.length) {
    const ch = paragraph[i];

    if (ch === "\t") {
      flushWord();
      pushSpace();
      pushSpace();
      pushSpace();
      pushSpace();
      i += 1;
      continue;
    }

    if (ch === " ") {
      flushWord();
      pushSpace();
      i += 1;
      continue;
    }

    if (ctx.mathMode) {
      const math = parseMathAtom(paragraph, i, ctx.math, ctx.size);
      if (math) {
        flushWord();
        atoms.push(math.atom);
        i = math.next;
        continue;
      }

      if (ch === "^" || ch === "_") {
        const parsed = parseScript(paragraph, i, ctx.math, ctx.size);
        if (parsed) {
          // Indeks hozir yozilayotgan so'zning oxirgi belgisiga tegishli
          // (masalan `x_1`), shuning uchun so'zni shu belgidan ajratamiz.
          if (word.length > 0) {
            const rest = word.slice(0, -1);
            const baseChar = word[word.length - 1];
            word = "";
            const restAtom = rest.length > 0 ? makeWordAtom(rest, ctx) : null;
            if (restAtom) atoms.push(restAtom);
            const baseAtom = makeWordAtom(baseChar, ctx);
            if (baseAtom) {
              atoms.push(wrapScript(baseAtom, parsed.script, parsed.isSuper, ctx.size));
              i = parsed.next;
              continue;
            }
          } else {
            const last = atoms[atoms.length - 1];
            if (last && !isSpaceAtom(last, ctx)) {
              const base = atoms.pop() as Atom;
              atoms.push(wrapScript(base, parsed.script, parsed.isSuper, ctx.size));
              i = parsed.next;
              continue;
            }
          }
        }
      }
    }

    word += ch;
    i += 1;
  }

  flushWord();
  return atoms;
}

/** Atomlarni qatorlarga bo'ladi (o'ng chegaradan oshsa, keyingi qatorga o'tadi). */
function wrapAtoms(atoms: Atom[], maxWidth: number, ctx: BuildContext): LineLayout[] {
  const lines: LineLayout[] = [];
  let current: PlacedAtom[] = [];
  let cursor = 0;

  const pushLine = () => {
    while (current.length > 0 && isSpaceAtom(current[current.length - 1].atom, ctx)) current.pop();
    if (current.length > 0) lines.push({ atoms: current });
    current = [];
    cursor = 0;
  };

  for (const atom of atoms) {
    if (cursor + atom.width > maxWidth && current.length > 0) {
      pushLine();
      if (isSpaceAtom(atom, ctx)) continue;
    }
    if (isSpaceAtom(atom, ctx) && current.length === 0) continue;
    current.push({ atom, x: cursor });
    cursor += atom.width;
  }

  pushLine();
  return lines;
}

export interface LayoutOptions {
  text: string;
  style: NotebookStyle;
  primary: HandwritingFont;
  secondary?: HandwritingFont;
  /**
   * Shriftlar orasida o'lchamni tenglashtirish koeffitsienti: x-balandligi
   * kichik shriftlar kattaroq chiziladi (fonts.generated.ts dan olinadi).
   */
  sizeScale?: number;
}

/** Butun matnni varaqalarga joylashtiradi. */
export function layoutText(options: LayoutOptions): LayoutResult {
  const { style, primary, secondary } = options;
  const warnings = new Set<string>();
  const { width, height } = pageSizeFor(style.pageFormat);
  const k = width / 1240;

  const ruleTop = Math.round(92 * k);
  const bottomMargin = Math.round(72 * k);
  const marginLeft = Math.round(style.marginLeft * k);
  const textLeft = marginLeft + Math.round(20 * k);
  const textRight = width - Math.round(56 * k);
  const maxWidth = Math.max(80, textRight - textLeft);

  const mathFont: MathFont = {
    advance: (ch) => {
      const font = fontFor(ch, buildCtx);
      if (font) return glyphAdvance(font, ch);
      if (hasSymbol(ch)) return symbolAdvance(ch);
      return 0.5;
    },
    usable: (ch) => Boolean(fontFor(ch, buildCtx) || hasSymbol(ch) || ALIASES[ch]),
    needsSymbol: (ch) => !fontFor(ch, buildCtx) && hasSymbol(ch),
  };

  const buildCtx: BuildContext = {
    primary,
    secondary,
    size: style.fontSize * (options.sizeScale ?? 1),
    mathMode: style.mathMode,
    warnings,
    math: { font: mathFont, warnings },
    spaceAtoms: new WeakSet(),
  };

  const normalized = options.text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00ad/g, "")
    .replace(/\u00a0/g, " ");

  const paragraphs = normalized.split("\n");
  const allLines: LineLayout[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      allLines.push({ atoms: [] });
      continue;
    }
    const atoms = buildAtoms(paragraph, buildCtx);
    const lines = wrapAtoms(atoms, maxWidth, buildCtx);
    if (lines.length === 0) allLines.push({ atoms: [] });
    else allLines.push(...lines);
  }

  const lineGap = style.lineGap;
  const usableHeight = Math.max(lineGap, height - ruleTop - bottomMargin);
  const linesPerPage = Math.max(1, Math.floor(usableHeight / lineGap));

  const pages: PageLayout[] = [];
  for (let i = 0; i < allLines.length; i += linesPerPage) {
    pages.push({ lines: allLines.slice(i, i + linesPerPage) });
  }
  if (pages.length === 0) pages.push({ lines: [] });

  const paper: PaperLayout = {
    width,
    height,
    ruleTop,
    lineGap,
    marginLeft,
    marginLine: style.marginLine,
  };

  return {
    pages,
    warnings: Array.from(warnings),
    paper,
    firstBaseline: ruleTop + lineGap - Math.round(3 * k),
    textLeft,
  };
}

export function baselineForLine(index: number, layout: LayoutResult): number {
  return layout.firstBaseline + index * layout.paper.lineGap;
}
