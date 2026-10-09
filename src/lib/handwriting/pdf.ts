/**
 * Minimal PDF yozuvchi: sahifalarga JPEG rasmlarni joylashtiradi.
 *
 * Nima uchun o'zimiz yozamiz: bot daftarni **kitob** ko'rinishida yuklab berishi
 * kerak, ya'ni bir necha betdan iborat bitta PDF. Tashqi kutubxonasiz buning
 * uchun faqat PDF konteynerini yozish kifoya: har bir bet — A4 sahifa, uning
 * ustiga butun sahifani qoplaydigan rasm (`/DCTDecode`, ya'ni JPEG baytlari
 * to'g'ridan-to'g'ri oqim sifatida qo'yiladi — qayta siqish yo'q, yo'qotish yo'q).
 *
 * Fayl tuzilishi (PDF 1.4):
 *   `%PDF-1.4` sarlavha → obyektlar (katalog, sahifalar daraxti, har bir bet
 *   uchun sahifa + kontent + rasm, ma'lumot) → `xref` jadvali → `trailer`.
 * Xref jadvalidagi har bir siljish haqiqiy obyekt boshigacha bo'lgan bayt
 * siljishidir; shuning uchun obyektlar yozilayotganda ularning o'rni yozib
 * boriladi (pastdagi `Writer.offset`).
 */

/** A4 sahifa o'lchami punktda (1 punkt = 1/72 dyuym). */
export const A4_PAGE_WIDTH = 595.28;
export const A4_PAGE_HEIGHT = 841.89;

export interface PdfImagePage {
  /** JPEG fayl baytlari (DCTDecode oqimi). */
  jpeg: Uint8Array;
  /** Rasmning piksel o'lchami (sahifa uni to'liq qoplaydi). */
  width: number;
  height: number;
}

export interface PdfOptions {
  /** Hujjat nomi (PDF metadatasida saqlanadi). */
  title?: string;
  pageWidth?: number;
  pageHeight?: number;
}

/** Baytlarni ketma-ket yozib, joriy siljishni biladigan yordamchi. */
class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;

  get offset(): number {
    return this.size;
  }

  bytes(data: Uint8Array): void {
    this.chunks.push(data);
    this.size += data.length;
  }

  /** Faqat ASCII/latin-1 matn (PDF tuzilishi shunday yoziladi). */
  text(value: string): void {
    const out = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) out[index] = value.charCodeAt(index) & 0xff;
    this.bytes(out);
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/** PDF son: ortiqcha nollarsiz (masalan `595.28`, `842`). */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "");
}

/**
 * PDF satri: oddiy ASCII bo'lsa `(…)`, aks holda UTF-16BE hex `<FEFF…>`
 * (shunda o'zbekcha nomlar ham to'g'ri saqlanadi).
 */
function pdfString(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return `(${value.replace(/[\\()]/g, (char) => `\\${char}`)})`;
  }
  let hex = "FEFF";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xffff) {
      const rest = code - 0x10000;
      hex += (0xd800 + (rest >> 10)).toString(16).padStart(4, "0");
      hex += (0xdc00 + (rest & 0x3ff)).toString(16).padStart(4, "0");
    } else {
      hex += code.toString(16).padStart(4, "0");
    }
  }
  return `<${hex.toUpperCase()}>`;
}

/**
 * Sahifalardan PDF yasaydi. Har bir sahifa A4 o'lchamda bo'lib, rasmi butun
 * sahifani qoplaydi (nisbat saqlanmaydi — rasm sahifa bilan bir xil nisbatda
 * chizilgan bo'lishi kutiladi).
 */
export function buildPdf(pages: PdfImagePage[], options: PdfOptions = {}): Uint8Array {
  if (pages.length === 0) throw new Error("buildPdf: kamida bitta sahifa kerak.");
  pages.forEach((page, index) => {
    if (page.jpeg.length === 0) throw new Error(`buildPdf: ${index + 1}-sahifada rasm yo'q.`);
    if (!(page.width > 0) || !(page.height > 0)) throw new Error(`buildPdf: ${index + 1}-sahifa o'lchami noto'g'ri.`);
  });

  const pageWidth = options.pageWidth ?? A4_PAGE_WIDTH;
  const pageHeight = options.pageHeight ?? A4_PAGE_HEIGHT;
  const title = options.title?.trim() || "Daftar";

  // Obyekt raqamlari: 1 — katalog, 2 — sahifalar daraxti, keyin har bir sahifa
  // uchun uchta obyekt (sahifa, kontent, rasm), oxirida ma'lumot obyekti.
  const pageIds = pages.map((_page, index) => 3 + index * 3);
  const contentIds = pages.map((_page, index) => 4 + index * 3);
  const imageIds = pages.map((_page, index) => 5 + index * 3);
  const infoId = 3 + pages.length * 3;

  const writer = new Writer();
  writer.text("%PDF-1.4\n");
  // Ikkilik fayl ekanini bildiruvchi izoh (PDF spetsifikatsiyasi tavsiya qiladi).
  writer.bytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = new Array<number>(infoId + 1).fill(0);
  const begin = (id: number, body: string): void => {
    offsets[id] = writer.offset;
    writer.text(`${id} 0 obj\n${body}\nendobj\n`);
  };

  begin(1, "<< /Type /Catalog /Pages 2 0 R >>");
  begin(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );

  pages.forEach((page, index) => {
    begin(
      pageIds[index],
      [
        "<< /Type /Page",
        `/Parent 2 0 R`,
        `/MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}]`,
        `/Resources << /XObject << /Im0 ${imageIds[index]} 0 R >> >>`,
        `/Contents ${contentIds[index]} 0 R >>`,
      ].join(" "),
    );

    const content = `q\n${num(pageWidth)} 0 0 ${num(pageHeight)} 0 0 cm\n/Im0 Do\nQ\n`;
    offsets[contentIds[index]] = writer.offset;
    writer.text(`${contentIds[index]} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

    offsets[imageIds[index]] = writer.offset;
    writer.text(
      [
        `${imageIds[index]} 0 obj`,
        `<< /Type /XObject /Subtype /Image`,
        `/Width ${page.width} /Height ${page.height}`,
        `/ColorSpace /DeviceRGB /BitsPerComponent 8`,
        `/Filter /DCTDecode /Length ${page.jpeg.length} >>`,
        `stream`,
      ].join("\n") + "\n",
    );
    writer.bytes(page.jpeg);
    writer.text("\nendstream\nendobj\n");
  });

  begin(
    infoId,
    `<< /Title ${pdfString(title)} /Producer ${pdfString("Student Daftari")} /Creator ${pdfString("Student Daftari")} >>`,
  );

  const xrefStart = writer.offset;
  writer.text(`xref\n0 ${infoId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= infoId; id += 1) {
    writer.text(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  writer.text(`trailer\n<< /Size ${infoId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return writer.finish();
}
