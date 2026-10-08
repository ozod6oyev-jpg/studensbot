/**
 * Botning butun oqimini tekshiradi: `bun run check:bot`
 *
 * Mahalliy "soxta Telegram" server ko'tariladi, bot unga ulanadi va haqiqiy
 * update yuboriladi. Tekshiriladi:
 *   1. `/start` — salomlashuv va pastdagi (reply) menyu;
 *   2. daftar yaratish (nom so'rash, 12 varaq) va matnni varaq-tomonga yozish;
 *   3. varaqning orqa tomonida qizil chegara O'NGDA bo'lishi (piksel orqali);
 *   4. sozlamalar bo'limlari: 10 siyoh, 3 qog'oz, yozuv uslubi (rasm varaqasi);
 *   5. `/fonts` ham rasm ko'rinishida kelishi va daftarlar ro'yxati;
 *   6. daftar kartasi: nom berish va o'zgartirish, hamda daftarni kitob (PDF)
 *      qilib yuklab olish (fayl haqiqatan PDF ekani tekshiriladi);
 *   7. "uslubimni nusxalash": so'zlar va raqamlar namunasi (rasm) o'lchanadi,
 *      uslub nomlanadi, bazaga faqat shu chat uchun yoziladi va boshqa
 *      foydalanuvchiga ko'rinmaydi; ikkinchi uslub saqlangach `🗑 Uslubni
 *      o'chirish` qaysi birini o'chirishni so'raydi — bekor qilinsa hech narsa
 *      o'chmaydi, tanlangan uslub esa bazadan o'chadi.
 *
 * Token talab qilinmaydi: TELEGRAM_API_BASE mock serverga qaratiladi.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { renderNotebook } from "../src/lib/handwriting/render";
import { FALLBACK_FONT_ID, fontEntry } from "../src/lib/handwriting/fonts.generated";
import { fontDisplayName } from "../src/lib/handwriting/names";
import type { NotebookStyle } from "../src/lib/handwriting/types";

const BOT_ENTRY = fileURLToPath(new URL("../bot/index.ts", import.meta.url));
const FONT_DIR = new URL("../src/assets/fonts/", import.meta.url);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_CHAT_ID = 4242;
/** Ikkinchi "foydalanuvchi" — shaxsiy uslub unga ko'rinmasligi kerak. */
const OTHER_CHAT_ID = 7777;

/** Namunada yoziladigan so'zlar (botdagi ro'yxat bilan bir xil). */
const SAMPLE_WORDS = "salom maktab daftar kitob qalam yozuv o'qituvchi do'stlik quyosh bahor";
/** Namunada yoziladigan raqamlar. */
const SAMPLE_DIGITS = "0 1 2 3 4 5 6 7 8 9";

/**
 * Foydalanuvchi surati o'rnida namunaviy varaqa chizib, JPEG qilib qaytaradi.
 * Telegram'ga yuborilgan haqiqiy surat ham qayta kodlanadi, shuning uchun
 * JPEG bosqichi o'lchovga xalaqit bermaydi.
 */
async function samplePhoto(text: string, style: Partial<NotebookStyle>): Promise<Buffer> {
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
    { data: Buffer.from(page.rgba.buffer, page.rgba.byteOffset, page.rgba.byteLength), width: page.width, height: page.height },
    82,
  );
  return Buffer.from(encoded.data);
}

/** Pastdagi menyu tugmalari (bot bilan bir xil matnlar). */
const  BTN = {
  text: "✍️ Matn kiritish",
  settings: "⚙️ Sozlamalar",
  ink: "🖋 Siyoh rangi",
  paper: "📄 Qog'oz turi",
  font: "✍️ Yozuv uslubi",
  writing: "📐 Yozuv sozlamalari",
  books: "📚 Daftarlar",
  newBook: "➕ Yangi daftar",
  styleCopy: "🖋 Uslubimni nusxalash",
  styleStart: "▶️ Namunani boshlash",
  styleSkipDigits: "⏭ Raqamlarsiz davom etish",
  styleCancel: "❌ Bekor qilish",
  styleStop: "⏹ Uslubni to'xtatish",
  styleDelete: "🗑 Uslubni o'chirish",
  skipName: "⏭ Nomsiz qoldirish",
} as const;

interface ReceivedPhoto {
  bytes: Buffer;
  caption: string;
  markup: string;
  method: string;
  /** Fayl nomi (multipart sarlavhasidagi `filename=`, PDF uchun muhim). */
  filename: string;
}
interface ReceivedText {
  text: string;
  markup: string;
}

let failures = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

/** multipart/form-data tanasidan bitta maydon baytlarini ajratib oladi. */
function partBytes(body: Buffer, boundary: string, field: string): Buffer | null {
  const marker = Buffer.from(`name="${field}"`);
  const index = body.indexOf(marker);
  if (index === -1) return null;
  const afterHeaders = body.indexOf("\r\n\r\n", index);
  if (afterHeaders === -1) return null;
  const start = afterHeaders + 4;
  const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), start);
  const end = nextBoundary === -1 ? body.length : nextBoundary;
  return body.subarray(start, end);
}

/** Multipart bo'lak sarlavhasidan fayl nomini o'qiydi (`filename="..."`). */
function partFilename(body: Buffer, boundary: string, field: string): string {
  const marker = Buffer.from(`name="${field}"`);
  const index = body.indexOf(marker);
  if (index === -1) return "";
  const headers = body.subarray(index, body.indexOf("\r\n\r\n", index)).toString("utf8");
  return /filename="([^"]*)"/.exec(headers)?.[1] ?? "";
}

/** multipart tanasidan matn maydonini o'qiydi (oxiridagi qator uzunishini olib tashlaydi). */
function partText(body: Buffer, boundary: string, field: string): string {
  const bytes = partBytes(body, boundary, field);
  return bytes ? bytes.toString("utf8").replace(/\r?\n?$/, "").replace(/\r$/, "") : "";
}

/** Klaviaturadagi barcha tugma matnlari. */
function keyboardLabels(markup: string): string[] {
  if (!markup) return [];
  try {
    const parsed = JSON.parse(markup) as { keyboard?: { text: string }[][] };
    if (!parsed.keyboard) return [];
    return parsed.keyboard.flat().map((button) => button.text);
  } catch {
    return [];
  }
}

interface MockTelegram {
  server: Server;
  port: number;
  photos: ReceivedPhoto[];
  texts: ReceivedText[];
  calls: string[];
  /** Yuklab olingan fayllar yo'llari (`getFile` → `/file/bot...`). */
  downloads: string[];
  /** Namunaviy rasmni ro'yxatga olib, `file_id` qaytaradi. */
  addFile(bytes: Buffer, name: string): string;
  /** Rasmli update yuboradi (xuddi foydalanuvchi surat tashlagandek). */
  pushPhoto(chatId: number, fileId: string): void;
  push(update: unknown): void;
}

async function startMockTelegram(): Promise<MockTelegram> {
  const photos: ReceivedPhoto[] = [];
  const texts: ReceivedText[] = [];
  const calls: string[] = [];
  const updates: unknown[] = [];
  const downloads: string[] = [];
  const files = new Map<string, Buffer>();

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = request.url ?? "";

      // Fayl yuklash: `/file/bot<token>/<file_path>`.
      const fileMatch = /\/file\/bot[^/]+\/(.+)$/.exec(url);
      if (fileMatch) {
        const path = decodeURIComponent(fileMatch[1]);
        downloads.push(path);
        const bytes = files.get(path);
        if (!bytes) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "image/jpeg", "content-length": String(bytes.length) });
        response.end(bytes);
        return;
      }

      const method = url.split("/bot")[1]?.split("/")[1] ?? "";
      calls.push(method);

      const reply = (payload: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      switch (method) {
        case "getMe":
          reply({ ok: true, result: { id: 1, username: "daftar_test_bot", first_name: "Daftar Test" } });
          break;
        case "getFile": {
          const parsed = JSON.parse(body.toString("utf8") || "{}") as { file_id?: string };
          const fileId = parsed.file_id ?? "";
          if (files.has(fileId)) reply({ ok: true, result: { file_id: fileId, file_path: fileId } });
          else reply({ ok: false, description: "file not found" });
          break;
        }
        case "deleteWebhook":
        case "setWebhook":
        case "sendChatAction":
          reply({ ok: true, result: true });
          break;
        case "getUpdates": {
          const next = updates.splice(0, updates.length);
          // Botning uzoq so'rovini kutmaslik uchun kichik kechikish.
          setTimeout(() => reply({ ok: true, result: next }), 150);
          break;
        }
        case "sendMessage": {
          const parsed = JSON.parse(body.toString("utf8") || "{}") as { text?: string; reply_markup?: unknown };
          texts.push({
            text: parsed.text ?? "",
            markup: parsed.reply_markup ? JSON.stringify(parsed.reply_markup) : "",
          });
          reply({ ok: true, result: { message_id: texts.length } });
          break;
        }
        case "sendPhoto":
        case "sendDocument": {
          const contentType = request.headers["content-type"] ?? "";
          const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
          const file = partBytes(body, boundary, method === "sendPhoto" ? "photo" : "document");
          if (!file) {
            reply({ ok: false, description: "fayl topilmadi" });
            break;
          }
          photos.push({
            bytes: Buffer.from(file),
            caption: partText(body, boundary, "caption"),
            markup: partText(body, boundary, "reply_markup"),
            method,
            filename: partFilename(body, boundary, method === "sendPhoto" ? "photo" : "document"),
          });
          reply({ ok: true, result: { message_id: photos.length } });
          break;
        }
        default:
          reply({ ok: true, result: true });
      }
    });
  });

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  let fileCounter = 0;
  let updateCounter = 0;

  return {
    server,
    port,
    photos,
    texts,
    calls,
    downloads,
    addFile: (bytes: Buffer, name: string) => {
      fileCounter += 1;
      const key = `samples/${fileCounter}-${name}`;
      files.set(key, bytes);
      return key;
    },
    pushPhoto: (chatId: number, fileId: string) => {
      updateCounter += 1;
      updates.push({
        update_id: 10_000 + updateCounter,
        message: {
          message_id: 10_000 + updateCounter,
          chat: { id: chatId, type: "private" },
          photo: [{ file_id: fileId, width: 1240, height: 1754 }],
        },
      });
    },
    push: (update: unknown) => updates.push(update),
  };
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Qizil chegara chizig'ining x koordinatasi. Chegara rangi (214, 85, 106) —
 * qog'ozdan ancha qizg'ish, shuning uchun eng ko'p "qizil" piksel yig'ilgan
 * ustunni qidiramiz.
 */
function marginColumnX(bytes: Buffer): number {
  const png = PNG.sync.read(bytes);
  const { width, height, data } = png;
  let best = -1;
  let bestCount = 0;

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      const index = (y * width + x) << 2;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (r > 150 && r - g > 40 && r - b > 25) count += 1;
    }
    if (count > bestCount) {
      bestCount = count;
      best = x;
    }
  }
  void height;
  return bestCount >= 50 ? best : -1;
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Kutilgan natija kelmadi (${label}), ${timeoutMs} ms ichida topilmadi.`);
}

async function main(): Promise<void> {
  const mock = await startMockTelegram();
  const dataDir = await mkdtemp(join(tmpdir(), "daftar-bot-"));
  console.log(`Mock Telegram: http://127.0.0.1:${mock.port}  (ma'lumotlar: ${dataDir})`);

  const child: ChildProcess = spawn("bun", [BOT_ENTRY], {
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "111:TEST",
      TELEGRAM_API_BASE: `http://127.0.0.1:${mock.port}`,
      BOT_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString("utf8")));

  let updateId = 0;
  /** Foydalanuvchi matn yuboradi (xuddi Telegram'dan kelgandek). */
  const send = (text: string, chatId = TEST_CHAT_ID): void => {
    updateId += 1;
    mock.push({
      update_id: updateId,
      message: { message_id: updateId, chat: { id: chatId, type: "private" }, text },
    });
  };
  /** Matnlarni sanash: eski xabar emas, yangisini kutish uchun. */
  const countTexts = (needle: string): number =>
    mock.texts.filter((entry) => entry.text.includes(needle)).length;

  try {
    await waitFor(() => mock.calls.includes("getUpdates"), 15000, "bot polling boshlandi");

    console.log("\n=== 1-holat: /start va pastdagi menyu ===");
    send("/start");
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Assalomu alaykum")), 15000, "salomlashuv");
    const greeting = mock.texts.filter((entry) => entry.text.includes("Assalomu alaykum")).pop();
    const greetingKeys = keyboardLabels(greeting?.markup ?? "");
    assert(Boolean(greeting), "birinchi /start da salomlashuv yuborildi");
    assert(
      greetingKeys.length === 2 && greetingKeys.includes(BTN.text) && greetingKeys.includes(BTN.settings),
      `pastdagi menyuda 2 ta tugma bor (${greetingKeys.join(", ")})`,
    );
    assert(
      (greeting?.markup ?? "").includes('"resize_keyboard":true'),
      "klaviatura pastdagi menyu sifatida (reply keyboard) yuborildi",
    );

    console.log("\n=== 2-holat: daftar yo'q — matn kiritish tugmasi ===");
    send(BTN.text);
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("daftaringiz yo'q")), 15000, "daftar yo'q javobi");
    const emptyBooks = mock.texts.filter((entry) => entry.text.includes("daftaringiz yo'q")).pop();
    const createKeys = keyboardLabels(emptyBooks?.markup ?? "");
    assert(
      ["12 varaq", "36 varaq", "48 varaq", "96 varaq"].every((label) => createKeys.includes(label)),
      `yangi daftar yaratish tugmalari ko'rsatildi (${createKeys.join(", ")})`,
    );

    console.log("\n=== 3-holat: daftar yaratish — qog'oz turi, nom so'rash va standart nom ===");
    send("12 varaq");
    const paperPromptOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.includes("varaqli daftar qanday bo'ladi?")).pop();
    await waitFor(() => Boolean(paperPromptOf()), 15000, "qog'oz turi so'rovi");
    const bookPaperKeys = keyboardLabels(paperPromptOf()?.markup ?? "");
    assert(
      ["📏 Yo'l-yo'l daftar", "🔲 Katak daftar", "📄 Oq qog'oz"].every((label) =>
        bookPaperKeys.includes(label),
      ),
      `varaq soni tanlangach qog'oz turi so'raladi (${bookPaperKeys.join(", ")})`,
    );
    // Katak daftar tanlaymiz: tanlov daftarda saqlanishi quyida tekshiriladi.
    send("🔲 Katak daftar");
    const namePromptOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.includes("Daftarga nom bering")).pop();
    await waitFor(() => Boolean(namePromptOf()), 15000, "nom so'rovi");
    assert(Boolean(namePromptOf()), "qog'oz turi tanlangach nom so'raladi");
    assert(
      (namePromptOf()?.text ?? "").includes("katak daftar"),
      "nom so'rashda tanlangan qog'oz ko'rsatildi",
    );
    assert(
      keyboardLabels(namePromptOf()?.markup ?? "").includes("⏭ Nomsiz qoldirish"),
      "nomsiz qoldirish tugmasi berildi",
    );
    send("⏭ Nomsiz qoldirish");
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("yaratildi")), 20000, "daftar yaratildi");
    const created = mock.texts.filter((entry) => entry.text.includes("yaratildi")).pop();
    assert(
      Boolean(created) &&
        created!.text.includes("1-daftar") &&
        created!.text.includes("12 varaq") &&
        created!.text.includes("24 bet"),
      `daftar standart nom bilan yaratildi: "${created?.text.split("\n")[0]}"`,
    );
    assert(
      (created?.text ?? "").includes("katak daftar"),
      `tanlangan qog'oz yaratish xabarida ko'rsatildi: "${created?.text.split("\n")[0]}"`,
    );
    assert(
      keyboardLabels(created?.markup ?? "").includes(BTN.settings),
      "yaratishdan keyin asosiy menyu qaytdi",
    );
    // Tanlov daftarning o'zida saqlanishi kerak (`paper: grid`).
    const createdBooks = JSON.parse(await readFile(join(dataDir, "notebooks.json"), "utf8")) as {
      notebooks?: { title?: string; paper?: string }[];
    };
    const storedPaper = createdBooks.notebooks?.[0]?.paper;
    assert(storedPaper === "grid", `tanlangan qog'oz daftarda saqlandi (paper: ${storedPaper})`);

    console.log("\n=== 4-holat: matn varaqqa yozilishi (old tomon) ===");
    send("Salom! x^2 + \\frac{1}{2} = 0");
    await waitFor(() => mock.photos.length >= 1, 40000, "birinchi varaqa rasmi");
    const firstPage = mock.photos[0];
    assert(firstPage.bytes.subarray(0, 8).equals(PNG_SIGNATURE), "yuborilgan fayl haqiqiy PNG");
    const size = pngSize(firstPage.bytes);
    assert(size.width === 1240 && size.height === 1754, `varaq A4 o'lchamda (${size.width}x${size.height})`);
    assert(firstPage.caption.includes("varaq"), `izohda varaq raqami bor: "${firstPage.caption.split("\n")[0]}"`);
    assert(firstPage.caption.includes("old tomoni"), "birinchi bet — old tomoni deb belgilandi");
    assert(
      firstPage.caption.includes("Katak"),
      `bet daftarning o'z qog'ozida chizildi: "${firstPage.caption.split("\n")[1] ?? ""}"`,
    );
    assert(
      firstPage.markup.includes('"keyboard"'),
      "rasm ostida ham pastdagi menyu yuborildi",
    );
    const rectoMargin = marginColumnX(firstPage.bytes);
    assert(rectoMargin > 0 && rectoMargin < 400, `old tomonda qizil chegara chapda (x = ${rectoMargin})`);

    console.log("\n=== 5-holat: varaq to'lgach keyingi bet — orqa tomon ===");
    const beforeLong = mock.photos.length;
    const versoOf = (from: number): ReceivedPhoto | undefined =>
      mock.photos.slice(from).find((photo) => photo.caption.includes("orqa tomoni"));
    // Diqqat: standart uslubda A4 betiga ~2000 belgi sig'adi, shuning uchun
    // matn bir betga sig'masligi uchun ancha uzun yuboramiz (~3800 belgi).
    send(
      "Daftar varaqlari ketma-ket to'ladi. ".repeat(105) +
        "Har bir yangi betda chegara tomoni almashadi — xuddi haqiqiy daftardagidek.",
    );
    // Orqa tomon rasmi kelguncha kutamiz: uzun matn ikkinchi betga o'tadi.
    await waitFor(() => Boolean(versoOf(beforeLong)), 90000, "orqa tomon (verso) rasmi");
    const batch = mock.photos.slice(beforeLong);
    assert(
      batch.some((photo) => photo.caption.includes("old tomoni")),
      `uzun matn joriy betni to'ldirdi (${batch.length} ta rasm)`,
    );
    const verso = versoOf(beforeLong);
    if (verso) {
      const versoMargin = marginColumnX(verso.bytes);
      assert(versoMargin > 900, `orqa tomonda qizil chegara o'ngda (x = ${versoMargin})`);
      assert(
        verso.caption.includes("1/12 varaq") && verso.caption.includes("2-bet"),
        `izohda varaq va bet raqami to'g'ri: "${verso.caption.split("\n")[0]}"`,
      );
    } else {
      assert(false, "orqa tomon rasmi topilmadi");
    }

    console.log("\n=== 6-holat: sozlamalar menyusi ===");
    send(BTN.settings);
    await waitFor(() => mock.texts.some((entry) => entry.text.startsWith("⚙️ Sozlamalar")), 15000, "sozlamalar");
    const settings = mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).pop();
    const settingsKeys = keyboardLabels(settings?.markup ?? "");
    assert(
      [BTN.ink, BTN.paper, BTN.font, BTN.writing, BTN.books].every((label) => settingsKeys.includes(label)),
      `sozlamalar bo'limlari alohida tugmalarda (${settingsKeys.length} tugma)`,
    );

    console.log("\n=== 7-holat: siyoh rangi (10 xil) ===");
    send(BTN.ink);
    const inkMenuOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.startsWith("🖋 Siyoh rangi —")).pop();
    await waitFor(() => Boolean(inkMenuOf()), 20000, "siyoh menyusi");
    const inkMenu = inkMenuOf();
    const inkKeys = keyboardLabels(inkMenu?.markup ?? "");
    assert(inkKeys.length >= 10, `siyoh menyusida 10 ta rang tugmasi bor (${inkKeys.length})`);
    send("Pushti");
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Siyoh rangi: Pushti")), 15000, "pushti tanlandi");
    assert(true, "siyoh rangi almashtirildi (Pushti)");

    console.log("\n=== 8-holat: qog'oz turi (3 xil) ===");
    send(BTN.paper);
    const paperMenuOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.startsWith("📄 Qog'oz turi (A4)")).pop();
    await waitFor(() => Boolean(paperMenuOf()), 20000, "qog'oz menyusi");
    const paperMenu = paperMenuOf();
    const paperKeys = keyboardLabels(paperMenu?.markup ?? "");
    assert(
      ["Yo'l-yo'l", "Katak", "Toza (A4)"].every((label) => paperKeys.some((key) => key.includes(label))),
      `qog'oz menyusida 3 xil variant (${paperKeys.join(", ")})`,
    );
    send("Katak");
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Qog'oz turi: katak")), 15000, "katak tanlandi");
    assert(true, "qog'oz turi almashtirildi (Katak)");

    console.log("\n=== 9-holat: yozuv uslubi — rasm varaqasi ===");
    const beforeSheet = mock.photos.length;
    send(BTN.font);
    await waitFor(() => mock.photos.length > beforeSheet, 40000, "shrift varaqasi rasmi");
    const sheet = mock.photos[mock.photos.length - 1];
    assert(sheet.bytes.subarray(0, 8).equals(PNG_SIGNATURE), "shriftlar ro'yxati rasm ko'rinishida keldi");
    assert(
      sheet.caption.includes("1-sahifa") && sheet.caption.includes("39 shrift"),
      `rasm izohida sahifa va shrift soni bor: "${sheet.caption.split("\n")[0]}"`,
    );
    const sheetKeys = keyboardLabels(sheet.markup);
    const numbered = sheetKeys.filter((label) => /^(✓ )?\d+\s/.test(label));
    assert(numbered.length >= 8, `rasmga mos 8 ta raqamli tugma bor (${numbered.length})`);

    const secondButton = sheetKeys.find((label) => /^(✓ )?2\s/.test(label));
    assert(Boolean(secondButton), `ikkinchi qator tugmasi topildi: "${secondButton}"`);
    // Tugma matnidan kutilgan shrift nomini olamiz (masalan "2 Pangolin" → "Pangolin").
    const expectedFont = (secondButton ?? "").replace(/^✓\s*/, "").replace(/^\d+\s+/, "");
    send((secondButton ?? "").replace(/^✓\s*/, ""));
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("✅ Yozuv uslubi:")), 20000, "shrift tanlandi");
    const chosenFont = mock.texts.filter((entry) => entry.text.includes("✅ Yozuv uslubi:")).pop();
    assert(
      Boolean(chosenFont) && chosenFont!.text.includes(expectedFont),
      `shrift tugmadan tanlandi: "${chosenFont?.text.split("\n")[0]}" (kutilgan: ${expectedFont})`,
    );

    console.log("\n=== 10-holat: yangi sozlamalar keyingi rasmga qo'llanishi ===");
    const beforeStyled = mock.photos.length;
    send("Yangi sozlamalar bilan yozilgan matn.");
    await waitFor(() => mock.photos.length > beforeStyled, 40000, "yangi sozlamali rasm");
    const styled = mock.photos[mock.photos.length - 1];
    const styleLine = styled.caption.split("\n")[1] ?? "";
    assert(styleLine.includes(expectedFont), `shrift qo'llandi: "${styleLine}"`);
    assert(styleLine.includes("Katak"), `qog'oz turi qo'llandi: "${styleLine}"`);
    assert(styleLine.includes("Pushti"), "siyoh rangi qo'llandi (pushti)");

    console.log("\n=== 11-holat: /fonts buyrug'i va daftarlar ro'yxati ===");
    const beforeCommand = mock.photos.length;
    send("/fonts");
    await waitFor(() => mock.photos.length > beforeCommand, 40000, "/fonts rasm varaqasi");
    assert(mock.photos[mock.photos.length - 1].caption.includes("Yozuv uslubi"), "/fonts ham rasm ko'rinishida javob berdi");

    send(BTN.books);
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Daftarlaringiz")), 15000, "daftarlar ro'yxati");
    const books = mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).pop();
    const bookKeys = keyboardLabels(books?.markup ?? "");
    assert(
      bookKeys.some((label) => /^📖 1-daftar • \d+\/24$/.test(label)),
      `daftar tugmasida band bo'lgan betlar ko'rsatildi (${bookKeys.join(", ")})`,
    );

    console.log("\n=== 12-holat: qisqa buyruqlar (/caveat, /pink) ===");
    const countText = (needle: string): number =>
      mock.texts.filter((entry) => entry.text.includes(needle)).length;
    const beforeCaveat = countText("✅ Yozuv uslubi: Caveat");
    send("/caveat");
    await waitFor(
      () => countText("✅ Yozuv uslubi: Caveat") > beforeCaveat,
      20000,
      "/caveat buyrug'i",
    );
    assert(true, "/caveat shriftni almashtirdi");
    const beforePink = countText("Siyoh rangi: Pushti");
    send("/pink");
    await waitFor(() => countText("Siyoh rangi: Pushti") > beforePink, 20000, "/pink buyrug'i");
    assert(true, "/pink siyoh rangini almashtirdi");
    assert(
      mock.texts[mock.texts.length - 1].markup.includes('"keyboard"'),
      "qisqa buyruqdan keyin ham pastdagi menyu qoldi",
    );

    console.log("\n=== 13-holat: yozuv sozlamalari — har biri alohida ochiladi ===");
    send(BTN.settings);
    await waitFor(() => mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).length > 0, 15000, "sozlamalar");
    send(BTN.writing);
    const writingOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.startsWith("📐 Yozuv sozlamalari")).pop();
    await waitFor(() => Boolean(writingOf()), 15000, "yozuv sozlamalari menyusi");
    const writingKeys = keyboardLabels(writingOf()?.markup ?? "");
    assert(
      ["🔠 O'lcham", "〰️ Qo'l tebranishi", "📏 Qator oralig'i", "🔢 Matematika", "🖼 Yuborish turi"].every(
        (label) => writingKeys.includes(label),
      ),
      `yozuv sozlamalari alohida tugmalarda (${writingKeys.length} tugma)`,
    );

    const beforeSize = mock.texts.length;
    send("🔠 O'lcham");
    await waitFor(() => mock.texts.length > beforeSize, 15000, "o'lcham menyusi");
    const sizeText = mock.texts[mock.texts.length - 1].text;
    const sizeKeys = keyboardLabels(mock.texts[mock.texts.length - 1].markup);
    assert(
      /o'lcham/i.test(sizeText) && /Joriy: \d+px/.test(sizeText),
      `o'lcham sozlamasi alohida ochildi ("${sizeText.split("\n")[0]}")`,
    );
    assert(
      sizeKeys.some((label) => /^(✓ )?\d+$/.test(label)),
      `o'lcham variantlari tugma ko'rinishida (${sizeKeys.join(", ")})`,
    );

    const beforeWobble = mock.texts.length;
    send("〰️ Qo'l tebranishi");
    await waitFor(() => mock.texts.length > beforeWobble, 15000, "tebranish menyusi");
    const wobbleKeys = keyboardLabels(mock.texts[mock.texts.length - 1].markup);
    assert(
      ["Tekis", "O'rtacha", "Jonli"].every((label) => wobbleKeys.some((key) => key.includes(label))),
      `qo'l tebranishi darajalari alohida ochildi (${wobbleKeys.join(", ")})`,
    );

    console.log("\n=== 14-holat: daftar kartasi (yozish, yuklab olish, nomini o'zgartirish) ===");
    send(BTN.books);
    const booksListOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).pop();
    await waitFor(() => Boolean(booksListOf()), 15000, "daftarlar ro'yxati");
    const firstBookButton = keyboardLabels(booksListOf()?.markup ?? "").find((label) => /^📖 /.test(label));
    assert(Boolean(firstBookButton), `daftar tugmasi topildi: "${firstBookButton}"`);
    const photosBeforeDownload = mock.photos.length;
    const documentsBeforeDownload = mock.photos.filter((photo) => photo.method === "sendDocument").length;
    /** Kartalar soni: eski kartani emas, yangisini kutish uchun. */
    const cardCount = (): number => mock.texts.filter((entry) => entry.text.startsWith("📖 «")).length;
    const cardsBeforeFirst = cardCount();
    send(firstBookButton ?? "");
    const cardOf = (): ReceivedText | undefined =>
      mock.texts.filter((entry) => entry.text.startsWith("📖 «")).pop();
    await waitFor(() => cardCount() > cardsBeforeFirst, 15000, "daftar kartasi");
    const cardKeys = keyboardLabels(cardOf()?.markup ?? "");
    assert(
      ["✍️ Shu daftarga yozish", "⬇️ PDF yuklab olish", "✏️ Nomini o'zgartirish", "⬅️ Daftarlar"].every((label) =>
        cardKeys.includes(label),
      ),
      `kartada 4 ta amal bor (${cardKeys.join(", ")})`,
    );
    assert(
      (cardOf()?.text ?? "").includes("2/24 bet") && (cardOf()?.text ?? "").includes("12"),
      `kartada varaq va bet hisobi ko'rsatilgan: "${cardOf()?.text.split("\n")[0]}"`,
    );

    console.log("\n=== 15-holat: daftar nomini o'zgartirish ===");
    send("✏️ Nomini o'zgartirish");
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("yangi nom yozib yuboring")),
      15000,
      "nom so'rovi (o'zgartirish)",
    );
    assert(true, "nomini o'zgartirish uchun matn so'raldi");
    send("Fizika 9-sinf");
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("Daftar nomi o'zgartirildi")),
      15000,
      "nom o'zgartirildi",
    );
    const renamed = mock.texts.filter((entry) => entry.text.includes("Daftar nomi o'zgartirildi")).pop();
    assert(
      (renamed?.text ?? "").includes("«Fizika 9-sinf»"),
      `nom yangilandi: "${renamed?.text.split("\n")[0]}"`,
    );
    assert(
      keyboardLabels(renamed?.markup ?? "").includes("⬇️ PDF yuklab olish"),
      "nom o'zgarganidan keyin karta qaytdi",
    );

    console.log("\n=== 16-holat: daftarni kitob (PDF) qilib yuklab olish ===");
    send("⬇️ PDF yuklab olish");
    await waitFor(
      () => mock.photos.filter((photo) => photo.method === "sendDocument").length > documentsBeforeDownload,
      120000,
      "PDF kitob",
    );
    const book = mock.photos.filter((photo) => photo.method === "sendDocument").pop();
    assert(Boolean(book), "daftar hujjat sifatida yuborildi");
    assert(
      (book?.bytes.subarray(0, 5).toString("latin1") ?? "") === "%PDF-",
      `fayl haqiqiy PDF: "${book?.bytes.subarray(0, 8).toString("latin1")}"`,
    );
    assert(book?.filename === "fizika-9-sinf.pdf", `fayl nomi daftar nomidan olindi: "${book?.filename}"`);
    const ascii = book?.bytes.toString("latin1") ?? "";
    const pdfPages = (ascii.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
    assert(pdfPages === 2, `kitobda band betlar soni qadar sahifa bor (${pdfPages} = 2)`);
    assert(ascii.includes("/DCTDecode"), "kitob sahifalari JPEG rasm sifatida joylashtirilgan");
    assert(
      ascii.includes("startxref") && ascii.trimEnd().endsWith("%%EOF"),
      "PDF xref jadvali va yakuni joyida",
    );
    assert(
      (book?.caption ?? "").includes("«Fizika 9-sinf»") && (book?.caption ?? "").includes("2 bet"),
      `kitob izohi to'g'ri: "${book?.caption.split("\n")[0]}"`,
    );
    assert(
      (book?.markup ?? "").includes("keyboard"),
      "kitobdan keyin ham pastdagi menyu qoldi",
    );

    console.log("\n=== 17-holat: bir xil nomli daftar va bo'sh daftarni yuklash ===");
    send(BTN.newBook);
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("varaq sonini tanlang")), 15000, "varaq tanlash");
    send("12 varaq");
    await waitFor(
      () => mock.texts.filter((entry) => entry.text.includes("varaqli daftar qanday bo'ladi?")).length > 0,
      15000,
      "qog'oz turi so'rovi (yangi daftar)",
    );
    send("🔲 Katak daftar");
    await waitFor(
      () => mock.texts.filter((entry) => entry.text.includes("Daftarga nom bering")).length > 0,
      15000,
      "nom so'rovi (yangi daftar)",
    );
    const beforeNamed = mock.texts.filter((entry) => entry.text.includes("yaratildi")).length;
    send("Fizika 9-sinf");
    await waitFor(
      () => mock.texts.filter((entry) => entry.text.includes("yaratildi")).length > beforeNamed,
      20000,
      "nom bilan yaratish",
    );
    const named = mock.texts.filter((entry) => entry.text.includes("yaratildi")).pop();
    assert(
      (named?.text ?? "").includes("«Fizika 9-sinf (2)»"),
      `nom takrorlanmasligi ta'minlandi: "${named?.text.split("\n")[0]}"`,
    );

    const listsBefore = mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).length;
    send(BTN.books);
    await waitFor(
      () => mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).length > listsBefore,
      15000,
      "daftarlar ro'yxati (2)",
    );
    const emptyBookButton = keyboardLabels(booksListOf()?.markup ?? "").find((label) =>
      label.includes("Fizika 9-sinf (2)"),
    );
    assert(Boolean(emptyBookButton), `yangi daftar ro'yxatda: "${emptyBookButton}"`);
    assert(
      keyboardLabels(booksListOf()?.markup ?? "").some((label) => label.includes("Fizika 9-sinf • 2/24")),
      "nom o'zgargan daftar ham ro'yxatda yangi nomi bilan",
    );
    const documentsBeforeEmpty = mock.photos.filter((photo) => photo.method === "sendDocument").length;
    const cardsBeforeEmpty = cardCount();
    send(emptyBookButton ?? "");
    await waitFor(() => cardCount() > cardsBeforeEmpty, 15000, "bo'sh daftar kartasi");
    send("⬇️ PDF yuklab olish");
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("hali yozilgan bet yo'q")),
      30000,
      "bo'sh daftar ogohlantirishi",
    );
    assert(true, "bo'sh daftar uchun PDF o'rniga ogohlantirish yuborildi");
    assert(
      mock.photos.filter((photo) => photo.method === "sendDocument").length === documentsBeforeEmpty,
      "bo'sh daftar uchun ortiqcha fayl yuborilmadi",
    );
    assert(mock.photos.length >= photosBeforeDownload, "rasmlar oqimi ham ishlashda davom etdi");

    console.log("\n=== 18-holat: «uslubimni nusxalash» bo'limi ===");
    const styleMenuCount = (): number => countTexts("🖋 Uslubimni nusxalash");
    const settingsCount = (): number => mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).length;
    const beforeSettingsA = settingsCount();
    send(BTN.settings);
    await waitFor(() => settingsCount() > beforeSettingsA, 15000, "sozlamalar (uslub)");
    const settingsA = mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).pop();
    assert(
      keyboardLabels(settingsA?.markup ?? "").includes(BTN.styleCopy),
      `sozlamalarda uslub bo'limi bor (${keyboardLabels(settingsA?.markup ?? "").join(", ")})`,
    );
    const beforeStyleMenu = styleMenuCount();
    send(BTN.styleCopy);
    await waitFor(() => styleMenuCount() > beforeStyleMenu, 15000, "uslub menyusi");
    const styleMenu = mock.texts.filter((entry) => entry.text.startsWith("🖋 Uslubimni nusxalash")).pop();
    assert(
      (styleMenu?.text ?? "").includes("ommaviy shriftlar") && (styleMenu?.text ?? "").includes("10 ta so'z"),
      `uslub bo'limi holatni va qoidani tushuntiradi: "${styleMenu?.text.split("\n")[0]}"`,
    );
    assert(
      keyboardLabels(styleMenu?.markup ?? "").includes(BTN.styleStart),
      "namuna boshlash tugmasi berildi",
    );

    console.log("\n=== 19-holat: 1-qadam — so'zlar namunasi ko'rsatmasi ===");
    const wordsPromptCount = (): number => countTexts("1-qadam: so'zlar namunasi");
    const beforeWordsPrompt = wordsPromptCount();
    send(BTN.styleStart);
    await waitFor(() => wordsPromptCount() > beforeWordsPrompt, 20000, "so'zlar ko'rsatmasi");
    const wordsPrompt = mock.texts.filter((entry) => entry.text.includes("1-qadam: so'zlar namunasi")).pop();
    assert((wordsPrompt?.text ?? "").includes("o'qituvchi") && (wordsPrompt?.text ?? "").includes("bahor"), "10 ta so'z ro'yxati ko'rsatildi");
    assert(
      (wordsPrompt?.text ?? "").includes("o'zgartirmasdan") && (wordsPrompt?.text ?? "").includes("tabiiyroq"),
      "asl yozuvni o'zgartirmasdan yozish tavsiya qilindi",
    );
    assert(keyboardLabels(wordsPrompt?.markup ?? "").includes(BTN.styleCancel), "bekor qilish tugmasi bor");

    console.log("\n=== 20-holat: rasm (so'zlar) qabul qilinadi — 2-qadam ===");
    const wordsFile = mock.addFile(
      await samplePhoto(SAMPLE_WORDS, { paper: "lined", marginLine: true, lineGap: 70 }),
      "sozlar.jpg",
    );
    const digitsPromptCount = (): number => countTexts("2-qadam: raqamlar namunasi");
    const beforeDigitsPrompt = digitsPromptCount();
    mock.pushPhoto(TEST_CHAT_ID, wordsFile);
    await waitFor(() => digitsPromptCount() > beforeDigitsPrompt, 60000, "raqamlar ko'rsatmasi");
    assert(mock.downloads.includes(wordsFile), "bot namunaviy rasmni yuklab oldi (getFile + fayl)");
    const digitsPrompt = mock.texts.filter((entry) => entry.text.includes("2-qadam: raqamlar namunasi")).pop();
    assert(/katak daftar/i.test(digitsPrompt?.text ?? ""), "raqamlar katak daftarga so'raldi");
    assert(
      keyboardLabels(digitsPrompt?.markup ?? "").includes(BTN.styleSkipDigits),
      "raqamlarsiz davom etish imkoni berildi",
    );

    console.log("\n=== 21-holat: raqamlar namunasi va o'lchov ===");
    mock.pushPhoto(
      TEST_CHAT_ID,
      mock.addFile(await samplePhoto(SAMPLE_DIGITS, { paper: "grid", marginLine: true }), "raqamlar.jpg"),
    );
    await waitFor(() => countTexts("Namunangiz o'lchandi") > 0, 180000, "namuna o'lchandi");
    const measured = mock.texts.filter((entry) => entry.text.includes("Namunangiz o'lchandi")).pop();
    assert((measured?.text ?? "").includes("Eng yaqin qo'lyozma:"), `eng yaqin qo'lyozma aniqlandi: "${(measured?.text ?? "").split("\n")[2]}"`);
    assert(
      (measured?.text ?? "").includes("Raqamlar namunasi ham hisobga olindi"),
      "raqamlar namunasi hisobga olingani aytildi",
    );
    assert(
      keyboardLabels(measured?.markup ?? "").includes(BTN.skipName),
      "uslubga nom berish so'raldi (nomsiz qoldirish tugmasi bilan)",
    );

    console.log("\n=== 22-holat: uslub nomlanadi va faqat egasi uchun saqlanadi ===");
    const beforeSaved = countTexts("uslubi saqlandi va yoqildi");
    send("Mening qo'lyozmam");
    await waitFor(() => countTexts("uslubi saqlandi va yoqildi") > beforeSaved, 30000, "uslub saqlandi");
    const savedStyle = mock.texts.filter((entry) => entry.text.includes("uslubi saqlandi va yoqildi")).pop();
    assert(
      (savedStyle?.text ?? "").includes("«Mening qo'lyozmam»") && (savedStyle?.text ?? "").includes("faqat sizga ko'rinadi"),
      `uslub nomi bilan saqlandi va maxfiyligi aytildi: "${savedStyle?.text.split("\n")[0]}"`,
    );
    const styleKeys = keyboardLabels(savedStyle?.markup ?? "");
    assert(
      styleKeys.some((label) => label.includes("✒️ Mening qo'lyozmam")),
      `uslub ro'yxatda (tanlash tugmasi) ko'rindi: ${styleKeys.filter((label) => label.includes("✒️")).join(", ")}`,
    );
    assert(styleKeys.includes(BTN.styleStop) && styleKeys.includes("🗑 Uslubni o'chirish"), "to'xtatish va o'chirish tugmalari bor");

    const stored = JSON.parse(await readFile(join(dataDir, "styles.json"), "utf8")) as {
      styles: { chatId: number; name: string; baseFont: string; summary: string; personal: Record<string, number | string> }[];
    };
    assert(stored.styles.length === 1, `bazada bitta uslub saqlandi (${stored.styles.length})`);
    assert(stored.styles[0]?.chatId === TEST_CHAT_ID, `uslub egasi (chatId) bilan yozildi: ${stored.styles[0]?.chatId}`);
    assert(stored.styles[0]?.name === "Mening qo'lyozmam", `nom bazada saqlandi: "${stored.styles[0]?.name}"`);
    assert(
      typeof stored.styles[0]?.baseFont === "string" &&
        typeof stored.styles[0]?.personal?.slant === "number" &&
        typeof stored.styles[0]?.personal?.weight === "number",
      `o'lchovlar ham saqlandi (asos: ${stored.styles[0]?.baseFont}, ${stored.styles[0]?.summary})`,
    );

    console.log("\n=== 23-holat: uslub boshqa foydalanuvchiga ko'rinmaydi ===");
    const beforeOtherMenu = styleMenuCount();
    send(BTN.styleCopy, OTHER_CHAT_ID);
    await waitFor(() => styleMenuCount() > beforeOtherMenu, 20000, "boshqa chatda uslub menyusi");
    const otherMenu = mock.texts.filter((entry) => entry.text.startsWith("🖋 Uslubimni nusxalash")).pop();
    assert(
      (otherMenu?.text ?? "").includes("ommaviy shriftlar") && !(otherMenu?.text ?? "").includes("Mening qo'lyozmam"),
      `boshqa foydalanuvchida saqlangan uslub ko'rinmaydi: "${(otherMenu?.text ?? "").split("\n")[4]}"`,
    );
    const otherKeys = keyboardLabels(otherMenu?.markup ?? "");
    assert(
      !otherKeys.some((label) => label.includes("Mening qo'lyozmam")) && otherKeys.includes(BTN.styleStart),
      `boshqa foydalanuvchi klaviaturasida begona uslub yo'q (${otherKeys.join(", ")})`,
    );
    const beforeOtherSettings = settingsCount();
    send(BTN.settings, OTHER_CHAT_ID);
    await waitFor(() => settingsCount() > beforeOtherSettings, 15000, "boshqa chat sozlamalari");
    const otherSettings = mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).pop();
    assert(
      (otherSettings?.text ?? "").includes("Uslub: ommaviy shriftlar"),
      "boshqa foydalanuvchida ommaviy shriftlar ishlatiladi",
    );

    console.log("\n=== 24-holat: yoqilgan uslub chizmaga qo'llanadi ===");
    const beforeOwnSettings = settingsCount();
    send(BTN.settings);
    await waitFor(() => settingsCount() > beforeOwnSettings, 15000, "sozlamalar (faol uslub)");
    const ownSettings = mock.texts.filter((entry) => entry.text.startsWith("⚙️ Sozlamalar")).pop();
    assert(
      (ownSettings?.text ?? "").includes("Uslub: «Mening qo'lyozmam» — o'z qo'lyozmangiz"),
      `faol uslub sozlamalarda ko'rinadi: "${(ownSettings?.text ?? "").split("\n").find((line) => line.includes("Uslub:"))}"`,
    );
    const beforeStyledPage = mock.photos.length;
    send("Shaxsiy uslub bilan yozilgan matn.");
    await waitFor(() => mock.photos.length > beforeStyledPage, 60000, "uslub bilan varaqa");
    const styledPage = mock.photos[mock.photos.length - 1];
    assert(styledPage.bytes.subarray(0, 8).equals(PNG_SIGNATURE), "uslub yoqilganda ham varaqa chizildi");
    const expectedStyleFont = fontDisplayName(String(stored.styles[0]?.baseFont ?? ""));
    assert(
      styledPage.caption.includes(expectedStyleFont),
      `rasm izohi shaxsiy uslub shrifti bilan: "${styledPage.caption.split("\n")[1]}" (kutilgan: ${expectedStyleFont})`,
    );

    console.log("\n=== 25-holat: uslubni to'xtatish ===");
    const beforeStopMenu = styleMenuCount();
    send(BTN.styleCopy);
    await waitFor(() => styleMenuCount() > beforeStopMenu, 15000, "uslub menyusi (to'xtatish)");
    const beforeStop = countTexts("uslub to'xtatildi");
    send(BTN.styleStop);
    await waitFor(() => countTexts("uslub to'xtatildi") > beforeStop, 15000, "uslub to'xtatildi");
    assert(true, "uslub to'xtatildi va ommaviy shriftlarga qaytildi");

    console.log("\n=== 26-holat: daftar kartasi — 🛠 Tahrirlash va ✍️ yozish joyi ===");
    const listsBeforeCard = mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).length;
    send(BTN.books);
    await waitFor(
      () => mock.texts.filter((entry) => entry.text.includes("Daftarlaringiz")).length > listsBeforeCard,
      15000,
      "daftarlar ro'yxati (tahrirlash)",
    );
    const editBookButton = keyboardLabels(booksListOf()?.markup ?? "").find((label) =>
      /^📖 Fizika 9-sinf • \d+\/24$/.test(label),
    );
    assert(Boolean(editBookButton), `tahrirlanadigan daftar topildi: "${editBookButton}"`);
    const cardsBeforeEdit = cardCount();
    send(editBookButton ?? "");
    await waitFor(() => cardCount() > cardsBeforeEdit, 15000, "daftar kartasi (tahrirlash)");
    const editCardKeys = keyboardLabels(cardOf()?.markup ?? "");
    assert(
      editCardKeys.includes("🛠 Tahrirlash"),
      `kartada tahrirlash tugmasi bor (${editCardKeys.join(", ")})`,
    );

    const editMenuCount = (): number => mock.texts.filter((entry) => entry.text.startsWith("🛠 «")).length;
    const beforeEditMenu = editMenuCount();
    send("🛠 Tahrirlash");
    await waitFor(() => editMenuCount() > beforeEditMenu, 15000, "tahrirlash menyusi");
    const editMenu = mock.texts.filter((entry) => entry.text.startsWith("🛠 «")).pop();
    const editMenuKeys = keyboardLabels(editMenu?.markup ?? "");
    assert(
      ["✂️ Yozuvni o'chirish", "↩️ Oxirgi amalni qaytarish", "✏️ Nomini o'zgartirish", "⬅️ Daftarlar"].every(
        (label) => editMenuKeys.includes(label),
      ),
      `tahrirlash menyusida o'chirish va orqaga qaytarish bor (${editMenuKeys.join(", ")})`,
    );

    const writePromptCount = (): number => countTexts("qayerdan yozamiz");
    const beforeWritePrompt = writePromptCount();
    send("✍️ Shu daftarga yozish");
    await waitFor(() => writePromptCount() > beforeWritePrompt, 20000, "yozish joyi so'rovi");
    const writePrompt = mock.texts.filter((entry) => entry.text.includes("qayerdan yozamiz")).pop();
    const writePromptText = writePrompt?.text ?? "";
    const writePromptKeys = keyboardLabels(writePrompt?.markup ?? "");
    assert(
      /\d+-bet, \d+-qatorda tugagan/.test(writePromptText) && /\d+ qator band, \d+ qator bo'sh/.test(writePromptText),
      `oxirgi yozuv joyi va betdagi bo'sh qatorlar sanab berildi: "${writePromptText.split("\n").find((line) => line.includes("bet"))}"`,
    );
    assert(
      ["▶️ Davom etish", "➕ Yangi betdan", "🔢 Qatorni tanlash"].every((label) => writePromptKeys.includes(label)),
      `joy tanlash tugmalari berildi (${writePromptKeys.join(", ")})`,
    );

    console.log("\n=== 27-holat: qator tanlash va qator tashlash ===");
    const linePromptCount = (): number => countTexts("qatorni tanlang");
    const beforeLinePrompt = linePromptCount();
    send("🔢 Qatorni tanlash");
    await waitFor(() => linePromptCount() > beforeLinePrompt, 20000, "qator tanlash so'rovi");
    const linePrompt = mock.texts.filter((entry) => entry.text.includes("qatorni tanlang")).pop();
    const lineButtons = keyboardLabels(linePrompt?.markup ?? "").filter((label) => /^\d+$/.test(label));
    assert(
      lineButtons.length > 0,
      `bo'sh qatorlar raqam bilan berildi (${lineButtons.slice(0, 5).join(", ")}...)`,
    );
    assert(
      (linePrompt?.text ?? "").includes("qator toza turibdi"),
      `betdagi toza qatorlar soni ko'rsatildi: "${(linePrompt?.text ?? "").split("\n").find((line) => line.includes("toza"))}"`,
    );
    const chosenLine = lineButtons[0] ?? "1";
    const skipPromptCount = (): number => countTexts("Nechta qator tashlab ketamiz");
    const beforeSkipPrompt = skipPromptCount();
    send(chosenLine);
    await waitFor(() => skipPromptCount() > beforeSkipPrompt, 20000, "qator tashlash so'rovi");
    const skipPrompt = mock.texts.filter((entry) => entry.text.includes("Nechta qator tashlab ketamiz")).pop();
    assert(
      keyboardLabels(skipPrompt?.markup ?? "").some((label) => /^⏭ \d+$/.test(label)),
      `tashlanadigan qator soni tugmalarda berildi (${keyboardLabels(skipPrompt?.markup ?? "").join(", ")})`,
    );

    const readyCount = (): number => countTexts("✅ Tayyor!");
    const beforeReady = readyCount();
    send("⏭ 1");
    await waitFor(() => readyCount() > beforeReady, 20000, "yozishga tayyor");
    const ready = mock.texts.filter((entry) => entry.text.includes("✅ Tayyor!")).pop();
    assert(
      /\d+-betning \d+-qatoridan boshlanadi/.test(ready?.text ?? ""),
      `yozish joyi tasdiqlandi: "${ready?.text.split("\n").find((line) => line.includes("boshlanadi"))}"`,
    );

    console.log("\n=== 28-holat: tanlangan qatordan yozish va yozuvni orqaga qaytarish ===");
    /** Barcha betlar matni: yozuv qaysi betga tushganini aniqlash uchun. */
    const readSideTexts = async (): Promise<Map<string, string>> => {
      const parsed: unknown = JSON.parse(await readFile(join(dataDir, "notebooks.json"), "utf8"));
      const list = Array.isArray(parsed)
        ? parsed
        : ((parsed as { notebooks?: unknown[] })?.notebooks ?? []);
      const map = new Map<string, string>();
      for (const item of list) {
        const notebook = item as { id?: string; sides?: { text?: string }[] };
        (notebook.sides ?? []).forEach((side, index) =>
          map.set(`${notebook.id ?? "?"}#${index}`, side.text ?? ""),
        );
      }
      return map;
    };
    const sidesBeforeFlow = await readSideTexts();
    const photosBeforeFlowWrite = mock.photos.length;
    const flowWrittenCount = (): number => countTexts("daftariga yozildi");
    const beforeFlowWrite = flowWrittenCount();
    send("Tanlangan qatordan boshlanadigan yangi yozuv.");
    await waitFor(() => flowWrittenCount() > beforeFlowWrite, 60000, "qatordan yozildi");
    await waitFor(() => mock.photos.length > photosBeforeFlowWrite, 60000, "yozilgan bet rasmi");
    const flowWritten = mock.texts.filter((entry) => entry.text.includes("daftariga yozildi")).pop();
    const flowWrittenText = flowWritten?.text ?? "";
    assert(
      /\d+-betning \d+-qatoridan boshlandi/.test(flowWrittenText) &&
        /\d+ qator band, tepadan sanaganda \d+ qator bo'sh/.test(flowWrittenText),
      `yozuv qayerdan boshlangani va bo'sh joy qayta sanaldi: "${flowWrittenText.split("\n")[1]}"`,
    );
    assert(
      keyboardLabels(flowWritten?.markup ?? "").includes("↩️ Yozuvni orqaga qaytarish"),
      "yozuvni orqaga qaytarish tugmasi berildi",
    );

    // «⏭ 1» tanlangani uchun orada aynan 1 qator bo'sh qolishi kerak: betga
    // qo'shilgan qism «\n\n» bilan boshlanadi (bitta qator uzilishi + bitta
    // bo'sh qator). Ilgari bu yerda o'ralgan paragraf hisobiga 2-3 qator
    // tashlanib ketardi.
    const sidesAfterFlow = await readSideTexts();
    const changedSides = Array.from(sidesAfterFlow.keys()).filter(
      (key) => (sidesAfterFlow.get(key) ?? "") !== (sidesBeforeFlow.get(key) ?? ""),
    );
    assert(changedSides.length === 1, `yozuv bitta betga tushdi (o'zgargan betlar: ${changedSides.length})`);
    const changedKey = changedSides[0] ?? "";
    const beforeSideText = sidesBeforeFlow.get(changedKey) ?? "";
    const afterSideText = sidesAfterFlow.get(changedKey) ?? "";
    const addedText = afterSideText.slice(beforeSideText.length);
    assert(
      afterSideText.startsWith(beforeSideText) &&
        addedText === "\n\nTanlangan qatordan boshlanadigan yangi yozuv.",
      `«⏭ 1» bilan aynan 1 qator tashlandi (qo'shilgan matn: ${JSON.stringify(addedText)})`,
    );

    const undoCount = (): number => countTexts("amali orqaga qaytarildi");
    const photosBeforeUndo = mock.photos.length;
    const beforeWriteUndo = undoCount();
    send("↩️ Yozuvni orqaga qaytarish");
    await waitFor(() => undoCount() > beforeWriteUndo, 30000, "yozuv orqaga qaytarildi");
    const writeUndo = mock.texts.filter((entry) => entry.text.includes("amali orqaga qaytarildi")).pop();
    assert(
      (writeUndo?.text ?? "").includes("«yozuv»"),
      `oxirgi yozuv orqaga qaytarildi: "${writeUndo?.text.split("\n")[0]}"`,
    );
    await waitFor(() => mock.photos.length > photosBeforeUndo, 60000, "qaytarilgan bet rasmi");
    assert(true, "qaytarilgandan keyin bet qayta chizilib yuborildi");

    console.log("\n=== 29-holat: yozuvni o'chirish (bet → qator → so'z → oraliq → tasdiq) ===");
    const beforeDeleteMenu = editMenuCount();
    send("🛠 Tahrirlash");
    await waitFor(() => editMenuCount() > beforeDeleteMenu, 15000, "tahrirlash menyusi (o'chirish)");
    const photosBeforeSlides = mock.photos.length;
    const slidesIntroCount = (): number => countTexts("O'chirish boshlanadigan betni tanlang");
    const beforeSlidesIntro = slidesIntroCount();
    send("✂️ Yozuvni o'chirish");
    await waitFor(() => slidesIntroCount() > beforeSlidesIntro, 60000, "yozilgan betlar slaydi");
    await waitFor(() => mock.photos.length > photosBeforeSlides, 60000, "betlar rasmi (slayd)");
    const slides = mock.texts.filter((entry) => entry.text.includes("O'chirish boshlanadigan betni tanlang")).pop();
    assert(
      (slides?.text ?? "").includes("Yozilgan betlar:") && mock.photos.length > photosBeforeSlides,
      `yozilgan betlar slayd qilib ko'rsatildi (${mock.photos.length - photosBeforeSlides} rasm)`,
    );
    const sideButtons = keyboardLabels(slides?.markup ?? "").filter((label) => /^📄 \d+-bet • \d+ qator$/.test(label));
    assert(sideButtons.length > 0, `bet tugmalari berildi: ${sideButtons.slice(0, 3).join(", ")}`);

    const startLineCount = (): number => countTexts("O'chirish boshlanadigan qatorning raqamini tanlang");
    const beforeStartLine = startLineCount();
    send(sideButtons[0] ?? "");
    await waitFor(() => startLineCount() > beforeStartLine, 20000, "boshlanish qatori so'rovi");
    const startLineMenu = mock.texts.filter((entry) => entry.text.includes("O'chirish boshlanadigan qatorning raqamini tanlang")).pop();
    assert(
      /\d+-qator: /.test(startLineMenu?.text ?? ""),
      `qatorlar matni bilan ko'rsatildi: "${(startLineMenu?.text ?? "").split("\n").find((line) => /-qator: /.test(line))}"`,
    );
    assert(
      keyboardLabels(startLineMenu?.markup ?? "").some((label) => /^\d+$/.test(label)),
      `qator raqamlari tugma ko'rinishida (${keyboardLabels(startLineMenu?.markup ?? "").slice(0, 5).join(", ")}...)`,
    );

    const wordPromptCount = (): number => countTexts("Tanlangan so'z ham o'chiriladi");
    const beforeWordPrompt = wordPromptCount();
    send("1");
    await waitFor(() => wordPromptCount() > beforeWordPrompt, 20000, "so'z tanlash so'rovi");
    const wordPrompt = mock.texts.filter((entry) => entry.text.includes("Tanlangan so'z ham o'chiriladi")).pop();
    assert(
      /1\) /.test(wordPrompt?.text ?? ""),
      `qatordagi so'zlar raqamlab berildi: "${(wordPrompt?.text ?? "").split("\n").find((line) => /^1\) /.test(line))}"`,
    );
    assert(
      keyboardLabels(wordPrompt?.markup ?? "").some((label) => label === "1"),
      `so'z raqamlari tugmalarda (${keyboardLabels(wordPrompt?.markup ?? "").slice(0, 5).join(", ")}...)`,
    );

    const endSlideCount = (): number => countTexts("Endi qayergacha o'chirishni tanlang");
    const beforeEndSlide = endSlideCount();
    send("1");
    await waitFor(() => endSlideCount() > beforeEndSlide, 60000, "tugash joyi so'rovi (slayd)");
    const endSlides = mock.texts.filter((entry) => entry.text.includes("Endi qayergacha o'chirishni tanlang")).pop();
    assert(
      (endSlides?.text ?? "").includes("Boshlanish:") && (endSlides?.text ?? "").includes("so'zi"),
      `boshlanish joyi saqlandi: "${(endSlides?.text ?? "").split("\n").find((line) => line.includes("Boshlanish"))}"`,
    );

    const endSideButtons = keyboardLabels(endSlides?.markup ?? "").filter((label) => /^📄 \d+-bet • \d+ qator$/.test(label));
    const beforeEndLine = startLineCount();
    send(endSideButtons[0] ?? "");
    await waitFor(() => startLineCount() > beforeEndLine, 20000, "tugash qatori so'rovi");
    const beforeEndWord = wordPromptCount();
    send("1");
    await waitFor(() => wordPromptCount() > beforeEndWord, 20000, "tugash so'zi so'rovi");
    // Tugash so'zi tanlanadi — shundan keyin tasdiqlash so'raladi.
    send("1");
    await waitFor(
      () => countTexts("O'chirishni tasdiqlaysizmi?") > 0,
      20000,
      "tasdiqlash so'rovi",
    );
    const confirm = mock.texts.filter((entry) => entry.text.includes("O'chirishni tasdiqlaysizmi?")).pop();
    const confirmText = confirm?.text ?? "";
    assert(
      confirmText.includes("dan") && confirmText.includes("gacha o'chiriladi"),
      `o'chirish oralig'i aniq aytildi: "${confirmText.split("\n").find((line) => line.includes("gacha"))}"`,
    );
    assert(/Jami \d+ ta so'z/.test(confirmText), `o'chiriladigan so'zlar sanaldi: "${confirmText.split("\n").find((line) => line.includes("Jami"))}"`);
    const confirmKeys = keyboardLabels(confirm?.markup ?? "");
    assert(
      confirmKeys.includes("✅ Ha, o'chirish") && confirmKeys.includes("❌ Bekor qilish"),
      `tasdiqlash va bekor qilish tugmalari berildi (${confirmKeys.join(", ")})`,
    );

    const photosBeforeDelete = mock.photos.length;
    const deletedCount = (): number => countTexts("🗑 O'chirildi:");
    send("✅ Ha, o'chirish");
    await waitFor(() => deletedCount() > 0, 30000, "o'chirildi");
    const deleted = mock.texts.filter((entry) => entry.text.includes("🗑 O'chirildi:")).pop();
    assert(
      /🗑 O'chirildi: \d+ ta so'z/.test(deleted?.text ?? ""),
      `o'chirilgan so'zlar soni aytildi: "${deleted?.text.split("\n")[0]}"`,
    );
    assert(
      keyboardLabels(deleted?.markup ?? "").includes("↩️ Oxirgi amalni qaytarish"),
      "o'chirishdan keyin orqaga qaytarish tugmasi berildi",
    );
    await waitFor(() => mock.photos.length > photosBeforeDelete, 60000, "tahrirlangan bet rasmi");
    assert(mock.photos.length > photosBeforeDelete, "o'chirilgan bet qayta chizilib yuborildi");

    console.log("\n=== 30-holat: o'chirishni orqaga qaytarish ===");
    const beforeDeleteUndo = undoCount();
    const photosBeforeDeleteUndo = mock.photos.length;
    send("↩️ Oxirgi amalni qaytarish");
    await waitFor(() => undoCount() > beforeDeleteUndo, 30000, "o'chirish qaytarildi");
    const deleteUndo = mock.texts.filter((entry) => entry.text.includes("amali orqaga qaytarildi")).pop();
    assert(
      (deleteUndo?.text ?? "").includes("«o'chirish»"),
      `o'chirish amali orqaga qaytarildi: "${deleteUndo?.text.split("\n")[0]}"`,
    );
    await waitFor(() => mock.photos.length > photosBeforeDeleteUndo, 60000, "qaytarilgan bet rasmi");
    assert(true, "qaytarilgan bet ham yangidan chizilib yuborildi");

    console.log("\n=== 31-holat: ✍️ Matn kiritish → daftar tanlash → qayerdan yozamiz ===");
    const pickListCount = (): number => countTexts("Qaysi daftarga yozamiz?");
    const beforePickList = pickListCount();
    send(BTN.text);
    await waitFor(() => pickListCount() > beforePickList, 15000, "daftar tanlash ro'yxati");
    const pickList = mock.texts.filter((entry) => entry.text.includes("Qaysi daftarga yozamiz?")).pop();
    const pickButton = keyboardLabels(pickList?.markup ?? "").find((label) => /^📖 Fizika 9-sinf/.test(label));
    assert(Boolean(pickButton), `ro'yxatdan daftar tanlanadi: "${pickButton}"`);
    const beforePickPrompt = writePromptCount();
    send(pickButton ?? "");
    await waitFor(() => writePromptCount() > beforePickPrompt, 30000, "daftar tanlangach yozish joyi so'rovi");
    const picked = mock.texts.filter((entry) => entry.text.includes("qayerdan yozamiz")).pop();
    assert(
      /\d+-qatorda tugagan/.test(picked?.text ?? "") && /\d+ qator band, \d+ qator bo'sh/.test(picked?.text ?? ""),
      `daftar tanlangach joy va bo'sh qatorlar sanaldi: "${(picked?.text ?? "").split("\n").find((line) => line.includes("bet"))}"`,
    );
    const beforeContinueSkip = skipPromptCount();
    send("▶️ Davom etish");
    await waitFor(() => skipPromptCount() > beforeContinueSkip, 20000, "davom etishda qator tashlash so'rovi");
    const continueSkipPrompt = mock.texts.filter((entry) => entry.text.includes("Nechta qator tashlab ketamiz")).pop();
    const underButton = keyboardLabels(continueSkipPrompt?.markup ?? "").find((label) => label.includes("tagidan"));
    assert(
      Boolean(underButton),
      `«yozuvning tagidan» tugmasi berildi (${keyboardLabels(continueSkipPrompt?.markup ?? "").join(", ")})`,
    );
    const beforeContinueReady = readyCount();
    send(underButton ?? "⏭ 0");
    await waitFor(() => readyCount() > beforeContinueReady, 20000, "davom etish tasdiqi");
    const continued = mock.texts.filter((entry) => entry.text.includes("✅ Tayyor!")).pop();
    assert(
      /\d+-betning \d+-qatoridan boshlanadi/.test(continued?.text ?? ""),
      `davom etish joyi tayinlandi: "${(continued?.text ?? "").split("\n").find((line) => line.includes("boshlanadi"))}"`,
    );

    console.log("\n=== 32-holat: ➕ Yangi betdan va yangi betni orqaga qaytarish ===");
    const beforeNewSideAsk = skipPromptCount();
    send("➕ Yangi betdan");
    await waitFor(() => skipPromptCount() > beforeNewSideAsk, 20000, "yangi bet uchun qator tashlash so'rovi");
    const newSideAsk = mock.texts.filter((entry) => entry.text.includes("Nechta qator tashlab ketamiz")).pop();
    assert(
      (newSideAsk?.text ?? "").includes("1-qatordan boshlanadi"),
      `yangi bet 1-qatoridan boshlanadi: "${(newSideAsk?.text ?? "").split("\n").find((line) => line.includes("boshlanadi"))}"`,
    );
    const beforeNewSideReady = readyCount();
    send("⏭ 0");
    await waitFor(() => readyCount() > beforeNewSideReady, 20000, "yangi bet tasdiqi");

    const beforeNewSideWrite = flowWrittenCount();
    const photosBeforeNewSideWrite = mock.photos.length;
    send("Yangi betdan boshlangan yozuv.");
    await waitFor(() => flowWrittenCount() > beforeNewSideWrite, 60000, "yangi betga yozildi");
    await waitFor(() => mock.photos.length > photosBeforeNewSideWrite, 60000, "yangi bet rasmi");
    const newSidePhoto = mock.photos[mock.photos.length - 1];
    assert(
      newSidePhoto.caption.includes("3-bet"),
      `yangi bet ochildi va yozuv shunga tushdi: "${newSidePhoto.caption.split("\n")[0]}"`,
    );
    const newSideWritten = mock.texts.filter((entry) => entry.text.includes("daftariga yozildi")).pop();
    assert(
      (newSideWritten?.text ?? "").includes("1-qatoridan boshlandi"),
      `yozuv yangi betning 1-qatoridan boshlandi: "${(newSideWritten?.text ?? "").split("\n")[1]}"`,
    );

    const beforeNewSideUndo = undoCount();
    send("↩️ Yozuvni orqaga qaytarish");
    await waitFor(() => undoCount() > beforeNewSideUndo, 30000, "yangi betga yozuv qaytarildi");
    const newSideUndo = mock.texts.filter((entry) => entry.text.includes("amali orqaga qaytarildi")).pop();
    assert(
      (newSideUndo?.text ?? "").includes("«yozuv»"),
      `yangi betga yozuv ham orqaga qaytarildi: "${newSideUndo?.text.split("\n")[0]}"`,
    );

    console.log("\n=== 33-holat: joy tanlashni bekor qilish ===");
    const beforeCancelPrompt = writePromptCount();
    send("✍️ Shu daftarga yozish");
    await waitFor(() => writePromptCount() > beforeCancelPrompt, 30000, "joy tanlash so'rovi (bekor qilish)");
    const photosBeforeCancel = mock.photos.length;
    const beforeCancel = countTexts("Joy tanlash bekor qilindi");
    send("❌ Bekor qilish");
    await waitFor(() => countTexts("Joy tanlash bekor qilindi") > beforeCancel, 20000, "bekor qilindi");
    const cancelled = mock.texts.filter((entry) => entry.text.includes("Joy tanlash bekor qilindi")).pop();
    assert(
      keyboardLabels(cancelled?.markup ?? "").includes("✍️ Shu daftarga yozish"),
      `bekor qilgach daftar kartasi tugmalari qaytdi (${keyboardLabels(cancelled?.markup ?? "").join(", ")})`,
    );
    assert(mock.photos.length === photosBeforeCancel, "bekor qilganda hech qanday bet chizilmadi");
    assert(
      flowWrittenCount() === beforeNewSideWrite + 1,
      "bekor qilingan matn daftarga yozilib ketmadi",
    );

    console.log("\n=== 34-holat: ikkinchi uslub va 🗑 o'chirish tanlovi ===");
    const menuCount = (): number =>
      mock.texts.filter((entry) => entry.text.startsWith("🖋 Uslubimni nusxalash")).length;
    const ownStylesOf = async (): Promise<{ chatId: number; name: string }[]> => {
      const parsed = JSON.parse(await readFile(join(dataDir, "styles.json"), "utf8")) as {
        styles: { chatId: number; name: string }[];
      };
      return parsed.styles.filter((record) => record.chatId === TEST_CHAT_ID);
    };

    // Ikkinchi uslub haqiqiy namuna yo'li bilan olinadi.
    const beforeSecondMenu = menuCount();
    send(BTN.styleCopy);
    await waitFor(() => menuCount() > beforeSecondMenu, 20000, "uslub menyusi (ikkinchi uslub)");
    const beforeSecondWords = countTexts("1-qadam: so'zlar namunasi");
    send(BTN.styleStart);
    await waitFor(() => countTexts("1-qadam: so'zlar namunasi") > beforeSecondWords, 20000, "ikkinchi namuna: so'zlar ko'rsatmasi");
    const beforeSecondDigits = countTexts("2-qadam: raqamlar namunasi");
    const beforeSecondMeasured = countTexts("Namunangiz o'lchandi");
    mock.pushPhoto(
      TEST_CHAT_ID,
      mock.addFile(await samplePhoto(SAMPLE_WORDS, { paper: "lined", marginLine: true, lineGap: 70 }), "sozlar-2.jpg"),
    );
    await waitFor(() => countTexts("2-qadam: raqamlar namunasi") > beforeSecondDigits, 60000, "ikkinchi namuna: raqamlar qadami");
    send(BTN.styleSkipDigits);
    await waitFor(() => countTexts("Namunangiz o'lchandi") > beforeSecondMeasured, 180000, "ikkinchi uslub o'lchandi");
    const beforeSecondSaved = countTexts("uslubi saqlandi va yoqildi");
    send("Ikkinchi uslub");
    await waitFor(() => countTexts("uslubi saqlandi va yoqildi") > beforeSecondSaved, 30000, "ikkinchi uslub saqlandi");
    const secondSaved = mock.texts.filter((entry) => entry.text.includes("uslubi saqlandi va yoqildi")).pop();
    assert(
      (secondSaved?.text ?? "").includes("«Ikkinchi uslub»"),
      `ikkinchi uslub ham saqlandi: "${(secondSaved?.text ?? "").split("\n")[0]}"`,
    );
    const twoStyleKeys = keyboardLabels(secondSaved?.markup ?? "");
    assert(
      twoStyleKeys.filter((label) => label.includes("✒️")).length === 2 && twoStyleKeys.includes(BTN.styleDelete),
      `ikkala uslub tanlash tugmasi bo'lib chiqdi (${twoStyleKeys.join(", ")})`,
    );

    const beforeCountMenu = menuCount();
    send(BTN.styleCopy);
    await waitFor(() => menuCount() > beforeCountMenu, 20000, "uslub menyusi (2/5)");
    const countMenu = mock.texts.filter((entry) => entry.text.startsWith("🖋 Uslubimni nusxalash")).pop();
    assert(
      (countMenu?.text ?? "").includes("Saqlangan uslublar (2/5)"),
      `bazadagi uslublar soni bilan ko'rsatildi: "${(countMenu?.text ?? "").split("\n").find((line) => line.startsWith("Saqlangan"))}"`,
    );
    assert(
      (countMenu?.text ?? "").includes("Mening qo'lyozmam") && (countMenu?.text ?? "").includes("Ikkinchi uslub"),
      "ro'yxat ikkala uslub nomini ko'rsatdi",
    );

    const pickerCount = (): number => countTexts("Qaysi uslubni o'chiray?");
    send(BTN.styleDelete);
    await waitFor(() => pickerCount() > 0, 20000, "o'chirish tanlovi");
    const picker = mock.texts.filter((entry) => entry.text.includes("Qaysi uslubni o'chiray?")).pop();
    assert(
      (picker?.text ?? "").includes("Mening qo'lyozmam") && (picker?.text ?? "").includes("Ikkinchi uslub"),
      `qaysi uslubni o'chirish so'raldi (ikkala nom ko'rsatildi): "${(picker?.text ?? "").split("\n").slice(2, 4).join(" / ")}"`,
    );
    const pickerKeys = keyboardLabels(picker?.markup ?? "");
    assert(
      pickerKeys.includes("🗑 Mening qo'lyozmam") &&
        pickerKeys.includes("🗑 Ikkinchi uslub") &&
        pickerKeys.includes(BTN.styleCancel),
      `har bir uslub uchun o'chirish tugmasi berildi (${pickerKeys.join(", ")})`,
    );

    // Bekor qilish: hech narsa o'chmaydi va uslublar faylda qoladi.
    const beforeDeleteCancel = countTexts("O'chirish bekor qilindi");
    send("❌ Bekor qilish");
    await waitFor(() => countTexts("O'chirish bekor qilindi") > beforeDeleteCancel, 20000, "o'chirish bekor qilindi");
    const deleteCancel = mock.texts.filter((entry) => entry.text.includes("O'chirish bekor qilindi")).pop();
    assert(
      keyboardLabels(deleteCancel?.markup ?? "").includes(BTN.styleStart),
      "bekor qilgach uslub bo'limi tugmalari qaytdi",
    );
    assert(
      (await ownStylesOf()).length === 2,
      `bekor qilinganda ikkala uslub ham bazada qoldi (${(await ownStylesOf()).length} ta)`,
    );

    // Kerakli uslubni tanlab o'chirish (ikkinchisi bazada qoladi).
    const beforeSecondPicker = pickerCount();
    send(BTN.styleDelete);
    await waitFor(() => pickerCount() > beforeSecondPicker, 20000, "o'chirish tanlovi (qayta)");
    const beforeDeleted = countTexts("uslubi o'chirildi");
    send("🗑 Ikkinchi uslub");
    await waitFor(() => countTexts("uslubi o'chirildi") > beforeDeleted, 20000, "uslub o'chirildi");
    const deletedStyle = mock.texts.filter((entry) => entry.text.includes("uslubi o'chirildi")).pop();
    assert(
      (deletedStyle?.text ?? "").includes("«Ikkinchi uslub»") && (deletedStyle?.text ?? "").includes("yana 1 ta uslub qoldi"),
      `tanlangan uslub o'chirildi va qolgani aytildi: "${(deletedStyle?.text ?? "").split("\n")[0]}"`,
    );
    const afterDeleteKeys = keyboardLabels(deletedStyle?.markup ?? "");
    assert(
      afterDeleteKeys.filter((label) => label.includes("✒️")).length === 1 &&
        afterDeleteKeys.some((label) => label.includes("Mening qo'lyozmam")),
      `o'chirgach ro'yxatda faqat qolgan uslub chiqdi (${afterDeleteKeys.join(", ")})`,
    );
    const ownLeft = await ownStylesOf();
    assert(
      ownLeft.length === 1 && ownLeft[0]?.name === "Mening qo'lyozmam",
      `faylda faqat tanlanmagan uslub qoldi (${ownLeft.map((record) => record.name).join(", ")})`,
    );
    const parsedStyles = JSON.parse(await readFile(join(dataDir, "styles.json"), "utf8")) as {
      styles: { chatId: number }[];
    };
    assert(
      parsedStyles.styles.filter((record) => record.chatId === OTHER_CHAT_ID).length === 0,
      "boshqa chatda uslub paydo bo'lmadi (egalik tekshirildi)",
    );

    console.log(
      `\nAPI chaqiruvlari: ${[
        "getMe",
        "deleteWebhook",
        "getUpdates",
        "sendChatAction",
        "sendPhoto",
        "sendDocument",
        "getFile",
      ]
        .map((call) => `${call}×${mock.calls.filter((item) => item === call).length}`)
        .join(", ")}`,
    );
  } catch (error) {
    // Kutilmagan xato bo'lsa bot loglarini ko'rsatamiz — sababini topish uchun.
    const tail = logs.join("").trim();
    if (tail) console.log(`\nBot loglari:\n${tail.slice(-2000)}`);
    throw error;
  } finally {
    child.kill("SIGKILL");
    mock.server.close();
    const tail = logs.join("").trim();
    if (tail && failures > 0) console.log(`\nBot loglari:\n${tail.slice(-2000)}`);
  }

  if (failures > 0) {
    console.error(`\nBOT TEKSHIRUVI YIQILDI: ${failures} ta shart bajarilmadi.`);
    process.exit(1);
  }
  console.log("\nBot tekshiruvi o'tdi: menyu → daftar → varaq-tomonga yozish → Telegram.");
}

main().catch((error) => {
  console.error("BOT TEKSHIRUVI YIQILDI:", error instanceof Error ? error.message : error);
  process.exit(1);
});
