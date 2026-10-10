/**
 * Tekshiruv skriptlari uchun umumiy yordamchi: namunaviy qo'lyozma surati.
 *
 * `check-bot.ts` ham, `check-mini-app.ts` ham "foydalanuvchi surati" o'rnida shu
 * funksiyani ishlatadi. Varaqa haqiqiy render orqali chizilib, JPEG qilib
 * qaytariladi: botdan o'tgan haqiqiy surat ham qayta kodlanadi, shuning uchun
 * JPEG bosqichi o'lchovga xalaqit bermaydi.
 */
import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { renderNotebook } from "../src/lib/handwriting/render";
import { FALLBACK_FONT_ID, fontEntry } from "../src/lib/handwriting/fonts.generated";
import type { NotebookStyle } from "../src/lib/handwriting/types";

const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);

/**
 * Foydalanuvchi surati o'rnida namunaviy varaqa chizib, JPEG qilib qaytaradi.
 * Telegram'ga yuborilgan haqiqiy surat ham qayta kodlanadi, shuning uchun
 * JPEG bosqichi o'lchovga xalaqit bermaydi.
 */
export async function samplePhoto(text: string, style: Partial<NotebookStyle>): Promise<Buffer> {
  const fonts: Record<string, Uint8Array> = {};
  for (const id of ["caveat", FALLBACK_FONT_ID]) {
    const entry = fontEntry(id);
    if (!entry) throw new Error(`"${id}" shrifti manifestda yo'q`);
    fonts[id] = new Uint8Array(await readFile(new URL(entry.file, FONT_DIR)));
  }
  const result = await renderNotebook({
    text,
    style: { font: "caveat", seed: 21, wobble: 0.4, fontSize: 40, ...style },
    fonts,
  });
  const page = result.pages[0];
  const encoded = jpeg.encode(
    {
      data: Buffer.from(page.rgba.buffer, page.rgba.byteOffset, page.rgba.byteLength),
      width: page.width,
      height: page.height,
    },
    82,
  );
  return Buffer.from(encoded.data);
}
