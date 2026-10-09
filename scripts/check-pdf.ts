/**
 * PDF yozuvchi va daftar → kitob konvertorini tekshiradi: `bun run check:pdf`
 *
 * Bu fayl PDF ni **tahlil qilib** tekshiradi (shunchaki "xato bermadi" emas):
 *   1. sarlavha, `xref` jadvali va `trailer` to'g'rimi — jadvaldagi har bir
 *      siljish haqiqatan shu obyektning boshiga ishora qiladimi;
 *   2. sahifalar soni, har bir sahifada JPEG rasm (`/DCTDecode`) borligi va
 *      uning o'lchami `jpeg-js` bilan ochib tekshirilishi;
 *   3. o'zbekcha nom UTF-16 sifatida to'g'ri yozilishi;
 *   4. daftar betlaridan kitob yasash: recto/verso tartibi, hajm bo'yicha
 *      qismlarga bo'lish va fayl nomi uchun xavfsiz matn.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import jpeg from "jpeg-js";
import { buildPdf } from "../src/lib/handwriting/pdf";
import {
  groupByBudget,
  renderNotebookPdf,
  slugifyTitle,
} from "../src/lib/handwriting/notebook-pdf";
import { renderNotebook } from "../src/lib/handwriting/render";
import { FALLBACK_FONT_ID, FONT_LIBRARY, fontEntry } from "../src/lib/handwriting/fonts.generated";

const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);
const OUT_DIR = "/tmp/daftar-check";

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

function bytesOf(pdf: Uint8Array): Buffer {
  return Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
}

interface PdfFacts {
  pages: number;
  images: {
    id: number;
    width: number;
    height: number;
    jpegStart: number;
    jpegLength: number;
    jpegBytes: Uint8Array;
  }[];
  problems: string[];
}

/** PDF ni tahlil qiladi: xref jadvali, sahifalar va rasmlar. */
function inspectPdf(pdf: Uint8Array): PdfFacts {
  const text = bytesOf(pdf).toString("latin1");
  const problems: string[] = [];
  if (!text.startsWith("%PDF-1.4\n")) problems.push("sarlavha %PDF-1.4 emas");
  if (!text.trimEnd().endsWith("%%EOF")) problems.push("%%EOF bilan tugamaydi");

  const xrefMatch = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  if (!xrefMatch) {
    problems.push("startxref topilmadi");
    return { pages: 0, images: [], problems };
  }

  const xrefAt = Number.parseInt(xrefMatch[1], 10);
  if (text.slice(xrefAt, xrefAt + 4) !== "xref") problems.push("startxref xref jadvaliga ishora qilmayapti");

  const xrefLines = text.slice(xrefAt).split("\n");
  const header = /^(\d+) (\d+)$/.exec(xrefLines[1] ?? "");
  if (!header) {
    problems.push("xref sarlavhasi o'qilmadi");
    return { pages: 0, images: [], problems };
  }
  const [, firstId, rawCount] = header;
  const count = Number.parseInt(rawCount, 10);
  const from = Number.parseInt(firstId, 10);

  const offsets = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const line = xrefLines[2 + index] ?? "";
    const entry = /^(\d{10}) (\d{5}) ([nf]) ?$/.exec(line);
    if (!entry) {
      problems.push(`${from + index}-xref yozuvi noto'g'ri: "${line}"`);
      continue;
    }
    const id = from + index;
    if (entry[3] === "f") {
      if (id !== 0) problems.push(`obyekt ${id} bo'sh deb belgilangan`);
      continue;
    }
    const offset = Number.parseInt(entry[1], 10);
    offsets.set(id, offset);
    if (!text.slice(offset, offset + 64).startsWith(`${id} 0 obj`)) {
      problems.push(`obyekt ${id} siljishi noto'g'ri (${offset})`);
    }
  }

  const pages = (text.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
  const images: PdfFacts["images"] = [];
  for (const [id, offset] of offsets) {
    // Obyekt chegarasini aniq olamiz (keyingi obyekt matni aralashib ketmasin).
    const endObj = text.indexOf("endobj", offset);
    const head = text.slice(offset, endObj < 0 ? offset + 400 : endObj);
    if (!head.includes("/Subtype /Image") || !head.includes("/DCTDecode")) continue;
    const width = Number.parseInt(/\/Width (\d+)/.exec(head)?.[1] ?? "0", 10);
    const height = Number.parseInt(/\/Height (\d+)/.exec(head)?.[1] ?? "0", 10);
    const length = Number.parseInt(/\/Length (\d+)/.exec(head)?.[1] ?? "0", 10);
    const streamAt = text.indexOf("stream\n", offset);
    if (streamAt < 0) {
      problems.push(`rasm obyekti ${id} da stream topilmadi`);
      continue;
    }
    const jpegStart = streamAt + "stream\n".length;
    const jpegBytes = pdf.subarray(jpegStart, jpegStart + length);
    if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) problems.push(`rasm ${id} JPEG (FFD8) bilan boshlanmaydi`);
    if (jpegBytes[jpegBytes.length - 2] !== 0xff || jpegBytes[jpegBytes.length - 1] !== 0xd9) {
      problems.push(`rasm ${id} JPEG (FFD9) bilan tugamaydi`);
    }
    images.push({ id, width, height, jpegStart, jpegLength: length, jpegBytes });
  }

  // Trailer /Size obyektlar soniga mos bo'lishi kerak.
  const size = Number.parseInt(/trailer\s*<<[^>]*\/Size (\d+)/.exec(text)?.[1] ?? "0", 10);
  if (size !== from + count) problems.push(`trailer /Size (${size}) xref bilan mos emas (${from + count})`);
  if (!/\/Root 1 0 R/.test(text)) problems.push("trailer /Root ko'rsatilmagan");

  return { pages, images, problems };
}

/** Asosiy fayldan shrift o'qish. */
async function loadFont(id: string): Promise<Uint8Array> {
  const entry = fontEntry(id);
  if (!entry) throw new Error(`"${id}" shrifti manifestda topilmadi`);
  return new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // --- 1. Yozuvchining o'zi: kichik sintetik rasmlar -----------------------
  console.log("=== 1-holat: PDF tuzilishi (3 sahifa, o'zbekcha nom) ===");
  const synthetic = [0, 1, 2].map((index) => {
    const width = 60;
    const height = 80;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      rgba[pixel * 4] = 240;
      rgba[pixel * 4 + 1] = 240;
      rgba[pixel * 4 + 2] = 250;
      rgba[pixel * 4 + 3] = 255;
    }
    for (let x = 5 + index * 3; x < 20 + index * 3; x += 1) {
      for (let y = 10; y < 60; y += 1) {
        const at = (y * width + x) * 4;
        rgba[at] = 27;
        rgba[at + 1] = 62;
        rgba[at + 2] = 143;
      }
    }
    const encoded = jpeg.encode({ data: Buffer.from(rgba.buffer), width, height }, 80);
    return { jpeg: new Uint8Array(encoded.data), width, height };
  });

  const pdf = buildPdf(synthetic, { title: "Matematika 8-sinf — 1-qism" });
  const facts = inspectPdf(pdf);
  const text = bytesOf(pdf).toString("latin1");

  assert(facts.problems.length === 0, `tuzilish xatolari yo'q${facts.problems.length ? `: ${facts.problems.join("; ")}` : ""}`);
  assert(facts.pages === 3, `sahifalar soni to'g'ri (${facts.pages} = 3)`);
  assert(facts.images.length === 3, `har bir sahifada bitta JPEG rasm (${facts.images.length})`);
  assert(
    facts.images.every((image) => image.width === 60 && image.height === 80),
    "rasm o'lchamlari saqlangan (60x80)",
  );
  assert(
    /\/MediaBox \[0 0 595\.28 841\.89\]/.test(text),
    "sahifa o'lchami A4 (595.28 x 841.89 pt)",
  );
  assert(/<FEFF004D00610074/.test(text), "o'zbekcha/non-ASCII nom UTF-16 sifatida yozilgan");
  assert(text.includes("/Producer (Student Daftari)"), "PDF metadatasida ishlab chiqaruvchi bor");

  // Rasmlar haqiqatan ochilishini tekshiramiz (baytlar JPEG emasligini ushlaydi).
  const decoded = facts.images.map((image) => jpeg.decode(image.jpegBytes, { useTArray: true }));
  assert(
    decoded.every((image, index) => image.width === synthetic[index].width && image.height === synthetic[index].height),
    "JPEG baytlari ochiladi va o'lchami mos",
  );
  const firstPixel = decoded[0].data[0];
  assert(firstPixel > 200, `ochilgan rasmda oq qog'oz ko'rinadi (R=${firstPixel})`);

  // Bufer bo'ylab siljishlarni ham tekshiramiz: siljishlar bayt bo'yicha to'g'ri.
  assert(
    bytesOf(pdf).subarray(facts.images[0].jpegStart, facts.images[0].jpegStart + 2).toString("hex") === "ffd8",
    "birinchi rasm baytlari xref orqali topilgan joyda",
  );
  const file = `${OUT_DIR}/kitob-namuna.pdf`;
  await writeFile(file, bytesOf(pdf));
  console.log(`  fayl: ${file} (${Math.round(pdf.byteLength / 1024)} KB)`);

  let threw = false;
  try {
    buildPdf([]);
  } catch {
    threw = true;
  }
  assert(threw, "bo'sh sahifalar ro'yxati xato qaytaradi");

  // --- 2. Hajm bo'yicha qismlarga bo'lish ---------------------------------
  console.log("\n=== 2-holat: qismlarga bo'lish va fayl nomi ===");
  assert(
    JSON.stringify(groupByBudget([10, 10, 10, 10], 25)) === JSON.stringify([[0, 1], [2, 3]]),
    "byudjetdan oshganda yangi qism boshlanadi",
  );
  assert(
    JSON.stringify(groupByBudget([100, 10], 20)) === JSON.stringify([[0], [1]]),
    "bitta katta sahifa alohida qism bo'ladi (yiqilmaydi)",
  );
  assert(groupByBudget([], 10).length === 0, "bo'sh ro'yxatda qism ham yo'q");
  assert(groupByBudget([5, 5], 1000).length === 1, "hajm kichik bo'lsa bitta qism");

  assert(slugifyTitle("Matematika 8-sinf") === "matematika-8-sinf", "fayl nomi xavfsiz ko'rinishga o'tdi");
  assert(slugifyTitle("Математика") === "daftar", "kirillcha nom uchun zaxira nom ishlatiladi");
  assert(slugifyTitle("   ") === "daftar", "bo'sh nom ham xato bermaydi");

  // --- 3. Daftar betlaridan kitob ----------------------------------------
  console.log("\n=== 3-holat: daftar betlaridan kitob yasash ===");
  const fonts: Record<string, Uint8Array> = {};
  fonts[FALLBACK_FONT_ID] = await loadFont(FALLBACK_FONT_ID);
  fonts[FONT_LIBRARY[1].id] = await loadFont(FONT_LIBRARY[1].id);

  const sides = [
    { text: "Birinchi bet: old tomon, chegara chapda.", side: "recto" as const },
    { text: "Ikkinchi bet: orqa tomon, chegara o'ngda.", side: "verso" as const },
    { text: "Uchinchi bet: keyingi varaqning old tomoni.", side: "recto" as const },
  ];

  const started = performance.now();
  const book = await renderNotebookPdf({ title: "Fizika daftari", sides, fonts, style: { font: FONT_LIBRARY[1].id } });
  const elapsed = Math.round(performance.now() - started);
  console.log(`  chizish: ${book.pages} bet, ${Math.round(book.volumes[0].pdf.byteLength / 1024)} KB, ${elapsed} ms`);

  assert(book.pages === 3, `kitobda 3 bet bor (${book.pages})`);
  assert(book.volumes.length === 1, "katta byudjetda kitob bitta fayl bo'ladi");
  const bookFacts = inspectPdf(book.volumes[0].pdf);
  assert(bookFacts.problems.length === 0, `kitob PDF tuzilishi to'g'ri${bookFacts.problems.length ? `: ${bookFacts.problems.join("; ")}` : ""}`);
  assert(bookFacts.pages === 3, `kitobda 3 PDF sahifa (${bookFacts.pages})`);
  assert(bookFacts.images.length === 3, `kitobda 3 rasm (${bookFacts.images.length})`);
  assert(
    bookFacts.images.every((image) => image.width === 1240 && image.height === 1754),
    "kitob sahifalari A4 o'lchamda chizilgan (1240x1754)",
  );

  // Har bir betda siyoh borligini piksel orqali tekshiramiz.
  const inks = bookFacts.images.map((image) => {
    const decodedImage = jpeg.decode(image.jpegBytes, { useTArray: true });
    let dark = 0;
    for (let at = 0; at < decodedImage.data.length; at += 4) {
      if (decodedImage.data[at] + decodedImage.data[at + 1] + decodedImage.data[at + 2] < 480) dark += 1;
    }
    return dark;
  });
  assert(inks.every((dark) => dark > 500), `har bir betda siyoh bor (${inks.join(", ")} piksel)`);

  // Orqa tomonning qizil chegarasi o'ngda bo'lishi kerak (kitobda ham).
  const versoImage = jpeg.decode(bookFacts.images[1].jpegBytes, { useTArray: true });
  const marginColumn = (image: { width: number; height: number; data: Uint8Array }): number => {
    let best = -1;
    let bestCount = 0;
    for (let x = 0; x < image.width; x += 1) {
      let count = 0;
      for (let y = 0; y < image.height; y += 1) {
        const at = (y * image.width + x) * 4;
        const r = image.data[at];
        const g = image.data[at + 1];
        const b = image.data[at + 2];
        if (r > 170 && g < 140 && b < 150) count += 1;
      }
      if (count > bestCount) {
        bestCount = count;
        best = x;
      }
    }
    return bestCount >= 50 ? best : -1;
  };
  assert(marginColumn(versoImage) > 900, `kitobdagi orqa tomonda chegara o'ngda (x = ${marginColumn(versoImage)})`);
  const rectoImage = jpeg.decode(bookFacts.images[0].jpegBytes, { useTArray: true });
  const rectoMargin = marginColumn(rectoImage);
  assert(rectoMargin > 0 && rectoMargin < 400, `kitobdagi old tomonda chegara chapda (x = ${rectoMargin})`);

  // Kichik byudjet: har bet alohida qism bo'lishi va betlar yo'qolmasligi kerak.
  const split = await renderNotebookPdf({
    title: "Fizika daftari",
    sides,
    fonts,
    style: { font: FONT_LIBRARY[1].id },
    volumeBytes: 1,
  });
  assert(split.volumes.length === 3, `kichik byudjetda 3 qism bo'ladi (${split.volumes.length})`);
  assert(
    split.volumes.map((volume) => volume.pages).join(",") === "1,1,1",
    "har bir qismda bittadan sahifa bor",
  );
  assert(
    split.volumes.map((volume) => `${volume.from}-${volume.to}`).join(",") === "0-0,1-1,2-2",
    "qismlar qaysi betlarga tegishli ekani to'g'ri ko'rsatilgan",
  );
  assert(
    split.volumes.every((volume) => inspectPdf(volume.pdf).pages === 1),
    "har bir qism haqiqiy bitta sahifali PDF",
  );

  let emptyThrew = false;
  try {
    await renderNotebookPdf({ sides: [], fonts });
  } catch {
    emptyThrew = true;
  }
  assert(emptyThrew, "bo'sh daftar uchun kitob yasalmaydi (xato qaytaradi)");

  if (failures > 0) {
    console.error(`\nPDF TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nPDF tekshiruvi o'tdi: tuzilish → qismlarga bo'lish → daftardan kitob.");
}

main().catch((error) => {
  console.error("PDF TEKSHIRUVI YIQILDI:", error);
  process.exit(1);
});
