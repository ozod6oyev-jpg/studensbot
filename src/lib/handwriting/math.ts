import type { Atom } from "./types";

/**
 * Matematika yozuvi: `\frac{a}{b}`, `\sqrt{x}`, `x^2`, `a_1` va `$...$`
 * ko'rinishidagi ifodalarni odatiy matn qatoriga sig'adigan "atom"larga
 * aylantiradi. Natija oddiy qo'lyozma shrifti bilan chiziladi.
 */

export interface MathFont {
  /** Belgi kengligi (em birligida). */
  advance(ch: string): number;
  /** Belgi chizilishi mumkinmi (shriftda yoki qalam harakatlarida). */
  usable(ch: string): boolean;
  /** Shriftda yo'q, lekin qalam harakatlari kutubxonasida bor. */
  needsSymbol(ch: string): boolean;
}

export interface MathContext {
  font: MathFont;
  warnings: Set<string>;
}

const LATEX_NAMES: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  partial: "∂",
  nabla: "∇",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftrightarrow: "⇔",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  deg: "°",
  because: "∵",
  therefore: "∴",
  propto: "∝",
};

const MAX_DEPTH = 8;

/** Indekslar (daraja/pastki indeks) asosiy shriftdan shu nisbatda kichik bo'ladi. */
const SCRIPT_SCALE = 0.62;

function glyphAtom(ch: string, size: number, ctx: MathContext): Atom {
  const width = ctx.font.advance(ch) * size;
  const useSymbol = ctx.font.needsSymbol(ch);
  return {
    width,
    ascent: 0.72 * size,
    descent: 0.26 * size,
    render(sink, x, baseline, alpha) {
      if (useSymbol) sink.symbol(ch, x, baseline, size, alpha);
      else sink.glyph(ch, x, baseline, size, alpha);
    },
  };
}

function spaceAtom(size: number, factor = 0.32): Atom {
  return {
    width: size * factor,
    ascent: 0,
    descent: 0,
    render() {
      /* bo'shliq hech narsa chizmaydi */
    },
  };
}

/** Kasr: surat ustida, maxraj pastda, orasida qalam bilan chizilgan chiziq. */
function fractionAtom(numerator: Atom, denominator: Atom, size: number): Atom {
  const padding = 0.14 * size;
  const barThickness = Math.max(1.3, 0.05 * size);
  const gap = 0.13 * size;
  const width = Math.max(numerator.width, denominator.width) + padding * 2;
  const axis = 0.3 * size; // chiziqning asosiy chiziqdan balandligi
  const ascent = axis + gap + numerator.descent + numerator.ascent + 0.04 * size;
  const descent = Math.max(0, gap + barThickness / 2 + denominator.ascent + denominator.descent - axis);

  return {
    width,
    ascent,
    descent: descent + 0.04 * size,
    render(sink, x, baseline, alpha) {
      const barY = baseline - axis;
      const numeratorBaseline = barY - gap - numerator.descent;
      const denominatorBaseline = barY + gap + barThickness / 2 + denominator.ascent;
      numerator.render(sink, x + (width - numerator.width) / 2, numeratorBaseline, alpha);
      denominator.render(sink, x + (width - denominator.width) / 2, denominatorBaseline, alpha);
      sink.line(x, barY, x + width, barY, barThickness, alpha);
    },
  };
}

/** Ildiz: qalam bilan chizilgan "tirqish" va ustki chiziq. */
function radicalAtom(body: Atom, size: number, index?: Atom): Atom {
  // Raqamlar va harflarning pastga qismi odatda bo'sh bo'ladi, shuning uchun
  // ustki chiziqni "descent"ning faqat bir qismidan hisoblaymiz — aks holda
  // chiziq matndan ancha balandda qolib ketadi.
  const tickHeight = body.ascent + body.descent * 0.32 + 0.09 * size;
  const tickWidth = tickHeight * 0.5;
  const overline = Math.max(0.08 * size, 0.06 * size);
  const bodyOffset = tickWidth + 0.06 * size;
  const indexWidth = index ? index.width + 0.04 * size : 0;
  const width = bodyOffset + body.width + overline;
  const ascent = tickHeight + 0.06 * size + (index ? 0.16 * size : 0);

  return {
    width: width + indexWidth,
    ascent,
    descent: Math.max(body.descent, tickHeight * 0.16),
    render(sink, x, baseline, alpha) {
      const top = baseline - tickHeight;
      const left = x + indexWidth;
      const thickness = Math.max(1.4, 0.07 * size);
      // Tirqish: matn koordinatalarida chizamiz ("√" ning qo'lda chizilgan shakli).
      const hookTop = { x: left + tickWidth * 0.18, y: baseline - tickHeight * 0.42 };
      const hookBottom = { x: left + tickWidth * 0.5, y: baseline + tickHeight * 0.12 };
      const hookCorner = { x: left + tickWidth, y: top };
      sink.line(hookTop.x, hookTop.y, hookBottom.x, hookBottom.y, thickness, alpha);
      sink.line(hookBottom.x, hookBottom.y, hookCorner.x, hookCorner.y, thickness, alpha);
      sink.line(
        hookCorner.x,
        top,
        hookCorner.x + body.width + overline,
        top,
        thickness * 0.85,
        alpha,
      );
      if (index) index.render(sink, x + 0.02 * size, top + 0.28 * size, alpha);
      body.render(sink, left + bodyOffset, baseline, alpha);
    },
  };
}

/** Daraja (yuqori indeks) va pastki indeks. */
function scriptAtom(base: Atom, script: Atom, isSuper: boolean, size: number): Atom {
  const shift = isSuper ? 0.4 * size : 0.18 * size;
  const width = base.width + Math.max(0, script.width - 0.06 * size);
  return {
    width,
    ascent: isSuper ? Math.max(base.ascent, script.ascent + shift) : base.ascent,
    descent: isSuper ? base.descent : Math.max(base.descent, script.descent + shift),
    render(sink, x, baseline, alpha) {
      base.render(sink, x, baseline, alpha);
      script.render(
        sink,
        x + base.width - 0.03 * size,
        isSuper ? baseline - shift : baseline + shift,
        alpha,
      );
    },
  };
}

function skipSpaces(src: string, index: number): number {
  let i = index;
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i += 1;
  return i;
}

function findClosing(src: string, index: number, open: string, close: string): number {
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `{...}` guruhini yoki bitta belgini atom sifatida o'qiydi. */
function parseGroup(src: string, index: number, ctx: MathContext, size: number, depth: number): { atom: Atom; next: number } | null {
  let i = skipSpaces(src, index);
  if (i >= src.length) return null;

  if (src[i] === "{") {
    const close = findClosing(src, i, "{", "}");
    if (close === -1) return null;
    const inner = src.slice(i + 1, close);
    const sequence = parseSequence(inner, 0, ctx, size, depth + 1);
    if (sequence.atoms.length === 0) return null;
    const atom: Atom = sequence.atoms.length === 1 ? sequence.atoms[0] : collapse(sequence.atoms);
    return { atom, next: close + 1 };
  }

  if (src[i] === "(") {
    const close = findClosing(src, i, "(", ")");
    if (close === -1) return null;
    const inner = src.slice(i + 1, close);
    const sequence = parseSequence(inner, 0, ctx, size, depth + 1);
    const innerAtom = sequence.atoms.length === 0 ? null : collapse(sequence.atoms);
    const openParen = glyphAtom("(", size, ctx);
    const closeParen = glyphAtom(")", size, ctx);
    const body = innerAtom ?? spaceAtom(size, 0);
    const atom: Atom = {
      width: openParen.width + body.width + closeParen.width,
      ascent: Math.max(openParen.ascent, body.ascent),
      descent: Math.max(openParen.descent, body.descent),
      render(sink, x, baseline, alpha) {
        openParen.render(sink, x, baseline, alpha);
        body.render(sink, x + openParen.width, baseline, alpha);
        closeParen.render(sink, x + openParen.width + body.width, baseline, alpha);
      },
    };
    return { atom, next: close + 1 };
  }

  const atom = parseMathAtom(src, i, ctx, size, depth);
  if (atom) return atom;

  // Oddiy bitta belgi — masalan `x_1`, `b^2` yoki `\frac a b`.
  if (src[i] === "\\") return null;
  if (!ctx.font.usable(src[i])) return null;
  return { atom: glyphAtom(src[i], size, ctx), next: i + 1 };
}

/** Bir nechta atomni bitta bo'lakka birlashtiradi (guruhlar uchun). */
function collapse(atoms: Atom[]): Atom {
  const width = atoms.reduce((sum, atom) => sum + atom.width, 0);
  const ascent = atoms.reduce((max, atom) => Math.max(max, atom.ascent), 0);
  const descent = atoms.reduce((max, atom) => Math.max(max, atom.descent), 0);
  return {
    width,
    ascent,
    descent,
    render(sink, x, baseline, alpha) {
      let cursor = x;
      for (const atom of atoms) {
        atom.render(sink, cursor, baseline, alpha);
        cursor += atom.width;
      }
    },
  };
}

/**
 * `src[index]` dan boshlab matematik ifodani (kasr, ildiz, belgi, `$...$`)
 * o'qishga harakat qiladi. Bo'lmasa `null`.
 */
export function parseMathAtom(
  src: string,
  index: number,
  ctx: MathContext,
  size: number,
  depth = 0,
): { atom: Atom; next: number } | null {
  if (depth > MAX_DEPTH || index >= src.length) return null;
  const ch = src[index];

  if (ch === "$") {
    const close = src.indexOf("$", index + 1);
    if (close === -1) return null;
    const inner = src.slice(index + 1, close);
    const sequence = parseSequence(inner, 0, ctx, size, depth + 1);
    if (sequence.atoms.length === 0) return null;
    return { atom: collapse(sequence.atoms), next: close + 1 };
  }

  if (ch === "\\") {
    const nameMatch = /^\\([a-zA-Z]+)/.exec(src.slice(index));
    if (!nameMatch) {
      // `\{`, `\}` kabi ekranlangan belgilar
      const escaped = src[index + 1];
      if (escaped) return { atom: glyphAtom(escaped, size, ctx), next: index + 2 };
      return null;
    }
    const name = nameMatch[1];
    const after = index + nameMatch[0].length;

    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const numerator = parseGroup(src, after, ctx, size, depth);
      if (!numerator) return null;
      const denominator = parseGroup(src, numerator.next, ctx, size, depth);
      if (!denominator) return null;
      return { atom: fractionAtom(numerator.atom, denominator.atom, size), next: denominator.next };
    }

    if (name === "sqrt") {
      let cursor = after;
      let indexAtom: Atom | undefined;

      // \sqrt[3]{x}
      if (src[cursor] === "[") {
        const close = findClosing(src, cursor, "[", "]");
        if (close !== -1) {
          const inner = src.slice(cursor + 1, close);
          const sequence = parseSequence(inner, 0, ctx, size, depth + 1);
          indexAtom = sequence.atoms.length > 0 ? collapse(sequence.atoms) : undefined;
          cursor = close + 1;
        }
      } else if (src[cursor] === "{") {
        // `\sqrt{3}{x}` ko'rinishidagi indeks: birinchi guruh indeks bo'lishi
        // uchun undan keyin yana bir guruh (ildiz ostidagi ifoda) turishi shart.
        const close = findClosing(src, cursor, "{", "}");
        if (close !== -1 && isNumericIndex(src.slice(cursor + 1, close))) {
          const after = skipSpaces(src, close + 1);
          if (after < src.length && (src[after] === "{" || src[after] === "(")) {
            const sequence = parseSequence(src.slice(cursor + 1, close), 0, ctx, size, depth + 1);
            indexAtom = sequence.atoms.length > 0 ? collapse(sequence.atoms) : undefined;
            cursor = close + 1;
          }
        }
      }

      const body = parseGroup(src, cursor, ctx, size, depth);
      if (!body) return null;
      return { atom: radicalAtom(body.atom, size, indexAtom), next: body.next };
    }

    const mapped = LATEX_NAMES[name];
    if (mapped) {
      return { atom: glyphAtom(mapped, size, ctx), next: after };
    }

    ctx.warnings.add(`Noma'lum buyruq: \\${name}`);
    return null;
  }

  if (ch === "√") {
    const body = parseGroup(src, index + 1, ctx, size, depth);
    if (!body) return null;
    return { atom: radicalAtom(body.atom, size), next: body.next };
  }

  if (ch === "^" || ch === "_") {
    return null;
  }

  return null;
}

function isNumericIndex(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && Array.from(trimmed).every((ch) => /[0-9]/.test(ch));
}

/** `^` yoki `_` dan keyingi indeksni o'qiydi. */
export function parseScript(
  src: string,
  index: number,
  ctx: MathContext,
  size: number,
): { script: Atom; next: number; isSuper: boolean } | null {
  const marker = src[index];
  if (marker !== "^" && marker !== "_") return null;
  const isSuper = marker === "^";
  const group = parseGroup(src, index + 1, ctx, size * SCRIPT_SCALE, 1);
  if (!group) return null;
  return { script: group.atom, next: group.next, isSuper };
}

export function wrapScript(base: Atom, script: Atom, isSuper: boolean, size: number): Atom {
  return scriptAtom(base, script, isSuper, size);
}

/** Matematik ifodani atomlar ketma-ketligiga aylantiradi (indekslar va kasrlar bilan). */
function parseSequence(
  src: string,
  start: number,
  ctx: MathContext,
  size: number,
  depth: number,
): { atoms: Atom[] } {
  const atoms: Atom[] = [];
  let i = start;

  while (i < src.length && depth <= MAX_DEPTH) {
    const ch = src[i];

    if (ch === " ") {
      atoms.push(spaceAtom(size, 0.3));
      i += 1;
      continue;
    }

    if (ch === "^" || ch === "_") {
      const parsed = parseScript(src, i, ctx, size);
      if (parsed && atoms.length > 0) {
        const previous = atoms.pop() as Atom;
        atoms.push(scriptAtom(previous, parsed.script, parsed.isSuper, size));
        i = parsed.next;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "/") {
      const denominator = parseGroup(src, i + 1, ctx, size, depth);
      if (denominator && atoms.length > 0) {
        const numerator = atoms.pop() as Atom;
        atoms.push(fractionAtom(numerator, denominator.atom, size * 0.92));
        i = denominator.next;
        continue;
      }
      i += 1;
      continue;
    }

    const math = parseMathAtom(src, i, ctx, size, depth);
    if (math) {
      atoms.push(math.atom);
      i = math.next;
      continue;
    }

    if (ch === "(" || ch === ")") {
      atoms.push(glyphAtom(ch, size, ctx));
      i += 1;
      continue;
    }

    if (ctx.font.usable(ch)) {
      atoms.push(glyphAtom(ch, size, ctx));
      i += 1;
      continue;
    }

    ctx.warnings.add(`Belgi chizilmadi: ${ch}`);
    i += 1;
  }

  return { atoms };
}

/** `$...$` ichidagi ifodani atomlar ketma-ketligiga aylantiradi (kasr bilan). */
export function mathSequenceAtom(src: string, ctx: MathContext, size: number): Atom | null {
  const sequence = parseSequence(src, 0, ctx, size, 0);
  if (sequence.atoms.length === 0) return null;
  return collapse(sequence.atoms);
}

/** Kasr va ildizni tashqi kod uchun ochiq qilamiz (test va maxsus holatlar uchun). */
export { fractionAtom, radicalAtom };
