/**
 * Botning butun oqimini tekshiradi: `bun run check:bot`
 *
 * Mahalliy "soxta Telegram" server ko'tariladi, bot unga ulanadi va haqiqiy
 * update yuboriladi. Tekshiriladi:
 *   1. `/start` — salomlashuv va pastdagi (reply) menyu;
 *   2. daftar yaratish (12 varaq) va matnni varaq-tomonga yozish;
 *   3. varaqning orqa tomonida qizil chegara O'NGDA bo'lishi (piksel orqali);
 *   4. sozlamalar bo'limlari: 10 siyoh, 3 qog'oz, yozuv uslubi (rasm varaqasi);
 *   5. `/fonts` ham rasm ko'rinishida kelishi va daftarlar ro'yxati.
 *
 * Token talab qilinmaydi: TELEGRAM_API_BASE mock serverga qaratiladi.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const BOT_ENTRY = fileURLToPath(new URL("../bot/index.ts", import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_CHAT_ID = 4242;

/** Pastdagi menyu tugmalari (bot bilan bir xil matnlar). */
const BTN = {
  text: "✍️ Matn kiritish",
  settings: "⚙️ Sozlamalar",
  ink: "🖋 Siyoh rangi",
  paper: "📄 Qog'oz turi",
  font: "✍️ Yozuv uslubi",
  writing: "📐 Yozuv sozlamalari",
  books: "📚 Daftarlar",
  newBook: "➕ Yangi daftar",
} as const;

interface ReceivedPhoto {
  bytes: Buffer;
  caption: string;
  markup: string;
  method: string;
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
  push(update: unknown): void;
}

async function startMockTelegram(): Promise<MockTelegram> {
  const photos: ReceivedPhoto[] = [];
  const texts: ReceivedText[] = [];
  const calls: string[] = [];
  const updates: unknown[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const method = (request.url ?? "").split("/bot")[1]?.split("/")[1] ?? "";
      calls.push(method);

      const reply = (payload: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      switch (method) {
        case "getMe":
          reply({ ok: true, result: { id: 1, username: "daftar_test_bot", first_name: "Daftar Test" } });
          break;
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

  return {
    server,
    port,
    photos,
    texts,
    calls,
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
  const send = (text: string): void => {
    updateId += 1;
    mock.push({
      update_id: updateId,
      message: { message_id: updateId, chat: { id: TEST_CHAT_ID, type: "private" }, text },
    });
  };

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

    console.log("\n=== 3-holat: 12 varaqli daftar yaratish ===");
    send("12 varaq");
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("yaratildi")), 20000, "daftar yaratildi");
    const created = mock.texts.filter((entry) => entry.text.includes("yaratildi")).pop();
    assert(
      Boolean(created) && created!.text.includes("12 varaq") && created!.text.includes("24 bet"),
      `daftar 12 varaq (24 bet) bilan yaratildi: "${created?.text.split("\n")[0]}"`,
    );
    assert(
      keyboardLabels(created?.markup ?? "").includes(BTN.settings),
      "yaratishdan keyin asosiy menyu qaytdi",
    );

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

    console.log(
      `\nAPI chaqiruvlari: ${["getMe", "deleteWebhook", "getUpdates", "sendChatAction", "sendPhoto", "sendDocument"]
        .map((call) => `${call}×${mock.calls.filter((item) => item === call).length}`)
        .join(", ")}`,
    );
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
