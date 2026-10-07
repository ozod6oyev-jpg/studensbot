import type { Contour } from "./types";

/**
 * Yuqori aniqlikda (supersampling) ishlaydigan binar maskali rasterizator.
 * Konturlar chetlari tekis chiziqlarga aylantirilgan holda beriladi.
 * Natija downsample qilinadi — shu bilan silliq qirralar (antialiasing) hosil bo'ladi.
 */
export class InkCanvas {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  private readonly maskWidth: number;
  private readonly maskHeight: number;
  private readonly mask: Uint8Array;

  constructor(width: number, height: number, scale = 3) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.scale = scale;
    this.maskWidth = this.width * scale;
    this.maskHeight = this.height * scale;
    this.mask = new Uint8Array(this.maskWidth * this.maskHeight);
  }

  /**
   * Konturlar guruhini to'ldiradi (even-odd qoidasi bo'yicha).
   * Har bir guruh alohida chaqirilishi kerak: binar yozuv tufayli
   * turli guruhlarning kesishishi avtomatik birlashadi.
   */
  fill(contours: Contour[]): void {
    if (contours.length === 0) return;
    const scale = this.scale;
    const maskWidth = this.maskWidth;
    const maskHeight = this.maskHeight;

    let minY = Infinity;
    let maxY = -Infinity;

    type Edge = { x1: number; y1: number; x2: number; y2: number };
    const edges: Edge[] = [];

    for (const contour of contours) {
      for (let i = 0; i < contour.length; i += 1) {
        const a = contour[i];
        const b = contour[(i + 1) % contour.length];
        const y1 = a.y * scale;
        const y2 = b.y * scale;
        if (y1 === y2) continue;
        edges.push({ x1: a.x * scale, y1, x2: b.x * scale, y2 });
        if (y1 < minY) minY = y1;
        if (y1 > maxY) maxY = y1;
        if (y2 < minY) minY = y2;
        if (y2 > maxY) maxY = y2;
      }
    }

    if (edges.length === 0) return;

    const startRow = Math.max(0, Math.floor(minY - 0.5));
    const endRow = Math.min(maskHeight - 1, Math.ceil(maxY + 0.5));
    const crossings: number[] = [];

    for (let row = startRow; row <= endRow; row += 1) {
      const sampleY = row + 0.5;
      crossings.length = 0;

      for (const edge of edges) {
        const top = edge.y1 < edge.y2 ? edge.y1 : edge.y2;
        const bottom = edge.y1 < edge.y2 ? edge.y2 : edge.y1;
        if (sampleY < top || sampleY >= bottom) continue;
        const t = (sampleY - edge.y1) / (edge.y2 - edge.y1);
        crossings.push(edge.x1 + t * (edge.x2 - edge.x1));
      }

      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);

      const rowOffset = row * maskWidth;
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const from = crossings[i];
        const to = crossings[i + 1];
        if (to - from <= 0) continue;
        const startX = Math.max(0, Math.ceil(from - 0.5));
        const endX = Math.min(maskWidth - 1, Math.floor(to - 0.5));
        for (let x = startX; x <= endX; x += 1) {
          this.mask[rowOffset + x] = 1;
        }
      }
    }
  }

  /**
   * Supersampling natijasini yakuniy o'lchamdagi qoplama (coverage 0..1)
   * massiviga aylantiradi. `destination` qayta ishlatilishi mumkin.
   */
  resolve(destination: Float32Array): Float32Array {
    const scale = this.scale;
    const samples = scale * scale;
    const out = destination.length === this.width * this.height
      ? destination
      : new Float32Array(this.width * this.height);

    if (scale === 1) {
      for (let i = 0; i < out.length; i += 1) out[i] = this.mask[i];
      return out;
    }

    for (let y = 0; y < this.height; y += 1) {
      const maskRow = y * scale * this.maskWidth;
      const outRow = y * this.width;
      for (let x = 0; x < this.width; x += 1) {
        let sum = 0;
        const maskCol = maskRow + x * scale;
        for (let dy = 0; dy < scale; dy += 1) {
          const rowStart = maskCol + dy * this.maskWidth;
          for (let dx = 0; dx < scale; dx += 1) {
            sum += this.mask[rowStart + dx];
          }
        }
        out[outRow + x] = sum / samples;
      }
    }

    return out;
  }
}
