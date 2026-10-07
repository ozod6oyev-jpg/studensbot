import { MATH_SYMBOLS } from "./symbols";
import type { Contour, StrokePath, Vec2 } from "./types";

const CIRCLE_SEGMENTS = 7;

function circle(x: number, y: number, radius: number): Contour {
  const points: Vec2[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
  }
  return points;
}

/**
 * Qalam harakatini konturlarga aylantiradi: har bir segment to'rtburchak,
 * har bir tugun dumaloq "bo'g'in" (shu bilan chiziq bir tekis qalinlikda
 * va uchlari dumaloq bo'ladi).
 *
 * `size` — shrift o'lchami (piksel), `ox`/`oy` — baseline boshlanish nuqtasi.
 * Kirish koordinatalari: em qutisi, y yuqoriga; chiqish: ekran koordinatalari.
 */
export function strokeToContours(strokes: StrokePath[], size: number, ox: number, oy: number): Contour[] {
  const contours: Contour[] = [];
  const toDevice = (point: Vec2) => ({ x: ox + point.x * size, y: oy - point.y * size });

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const width = Math.max(0.02, stroke.width ?? 0.075) * size;
    const radius = width / 2;
    const points = stroke.points.map(toDevice);

    if (stroke.closed && points.length > 1) {
      points.push({ ...points[0] });
    }

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      const nx = (-dy / len) * radius;
      const ny = (dx / len) * radius;
      contours.push([
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ]);
    }

    for (const point of points) {
      contours.push(circle(point.x, point.y, radius));
    }
  }

  return contours;
}

/** Belgining kengligi (em birligida). */
export function symbolAdvance(ch: string): number {
  const def = MATH_SYMBOLS[ch];
  if (!def) return 0.6;
  return def.advance ?? 0.62;
}

export function hasSymbol(ch: string): boolean {
  return Boolean(MATH_SYMBOLS[ch]);
}

export function symbolStrokes(ch: string): StrokePath[] {
  return MATH_SYMBOLS[ch]?.strokes ?? [];
}

/** To'g'ri chiziqni yupqa to'rtburchak konturiga aylantiradi (kasr chizig'i, ildiz ustki chizig'i). */
export function thickLine(x1: number, y1: number, x2: number, y2: number, thickness: number): Contour {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  return [
    { x: x1 + nx, y: y1 + ny },
    { x: x2 + nx, y: y2 + ny },
    { x: x2 - nx, y: y2 - ny },
    { x: x1 - nx, y: y1 - ny },
  ];
}
