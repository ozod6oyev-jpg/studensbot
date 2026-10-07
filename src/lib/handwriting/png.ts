/**
 * Sof JS PNG kodlovchi (RGBA, 8 bit, filtrsiz).
 * Brauzerda ham, Node/Bun'da ham ishlaydi — `CompressionStream` (zlib) standart.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const GlobalCompressionStream = (globalThis as { CompressionStream?: unknown }).CompressionStream;
  if (typeof GlobalCompressionStream !== "function") {
    throw new Error("Bu muhitda CompressionStream mavjud emas — PNG yozib bo'lmadi.");
  }

  const Compressor = GlobalCompressionStream as new (format: string) => unknown;
  const stream = new Compressor("deflate") as {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
  };

  const writer = stream.writable.getWriter();
  const copy = new Uint8Array(data.length);
  copy.set(data);
  void writer.write(copy);
  void writer.close();

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.length;
    }
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * RGBA piksellarni PNG faylga aylantiradi.
 *
 * Filtr turi "None" (0): sinovdan o'tkazilgan filtrlar (1–4) qog'oz
 * tolasidagi mayin shovqin tufayli kattaroq fayl beradi (o'lchandi:
 * 0 → 1925 KB, 1 → 2155 KB, 2 → 2373 KB), shuning uchun eng sodda
 * variant eng kichigi bo'lib qoladi.
 */
export async function encodePng(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const rowLength = width * 4;
  const raw = new Uint8Array(height * (rowLength + 1));

  for (let y = 0; y < height; y += 1) {
    const source = y * rowLength;
    const target = y * (rowLength + 1);
    raw[target] = 0;
    for (let i = 0; i < rowLength; i += 1) {
      raw[target + 1 + i] = rgba[source + i];
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit chuqurligi
  ihdr[9] = 6; // rang turi: RGBA
  ihdr[10] = 0; // siqish
  ihdr[11] = 0; // filtr usuli
  ihdr[12] = 0; // interlace

  const compressed = await deflate(raw);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
