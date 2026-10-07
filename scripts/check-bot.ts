/**
 * Botning butun oqimini tekshiradi: `bun run check:bot`
 *
 * Mahalliy "soxta Telegram" server ko'tariladi, bot unga ulanadi va haqiqiy
 * update yuboriladi. Test botning Telegram API bilan qanday gaplashishini
 * (getMe, getUpdates, sendChatAction, sendPhoto, sendMessage) va yuborilgan
 * rasm haqiqiy PNG ekanini tekshiradi — token talab qilinmaydi.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BOT_ENTRY = fileURLToPath(new URL("../bot/index.ts", import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_CHAT_ID = 4242;

interface ReceivedPhoto {
  bytes: Buffer;
  caption: string;
}
interface ReceivedText {
  text: string;
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

/** multipart tanasidan matn maydonini o'qiydi. */
function partText(body: Buffer, boundary: string, field: string): string {
  const bytes = partBytes(body, boundary, field);
  return bytes ? bytes.toString("utf8") : "";
}

interface MockTelegram {
  server: Server;
  port: number;
  photos: ReceivedPhoto[];
  texts: ReceivedText[];
  calls: string[];
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
        case "answerCallbackQuery":
        case "editMessageReplyMarkup":
          reply({ ok: true, result: true });
          break;
        case "getUpdates": {
          const next = updates.splice(0, updates.length);
          // Botning uzoq so'rovini kutmaslik uchun kichik kechikish.
          setTimeout(() => reply({ ok: true, result: next }), 150);
          break;
        }
        case "sendMessage": {
          const parsed = JSON.parse(body.toString("utf8") || "{}") as { text?: string };
          texts.push({ text: parsed.text ?? "" });
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
  } as MockTelegram & { push: (update: unknown) => void };
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
  const mock = (await startMockTelegram()) as MockTelegram & { push: (update: unknown) => void };
  const dataDir = await mkdtemp(join(tmpdir(), "daftar-bot-"));
  console.log(`Mock Telegram: http://127.0.0.1:${mock.port}  (sozlamalar: ${dataDir})`);

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

  try {
    await waitFor(() => mock.calls.includes("getUpdates"), 15000, "bot polling boshlandi");

    console.log("\n=== 1-holat: oddiy matn ===");
    mock.push({
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: TEST_CHAT_ID, type: "private" },
        text: "Salom! x^2 + \\frac{1}{2} = 0",
      },
    });
    await waitFor(() => mock.photos.length >= 1, 30000, "birinchi rasm");

    const first = mock.photos[0];
    assert(first.bytes.subarray(0, 8).equals(PNG_SIGNATURE), "yuborilgan fayl haqiqiy PNG");
    const size = pngSize(first.bytes);
    assert(
      size.width === 1240 && size.height === 1754,
      `varaq o'lchami A4 (${size.width}x${size.height})`,
    );
    assert(first.bytes.byteLength > 20_000, `rasm siqilmagan, ${Math.round(first.bytes.byteLength / 1024)} KB`);
    assert(first.caption.includes("yo'l-yo'l daftar"), `izohda qog'oz turi bor: "${first.caption.split("\n")[0]}"`);
    assert(first.caption.includes("varaq"), "izohda varaq raqami bor");

    console.log("\n=== 2-holat: /grid buyrug'i va keyingi matn ===");
    mock.push({
      update_id: 2,
      message: { message_id: 2, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/grid" },
    });
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("katak daftar")),
      15000,
      "/grid tasdiqi",
    );
    assert(true, "/grid buyrug'i sozlamani o'zgartirdi");

    mock.push({
      update_id: 3,
      message: { message_id: 3, chat: { id: TEST_CHAT_ID, type: "private" }, text: "a_1 + x^2 - 5x = 0" },
    });
    await waitFor(() => mock.photos.length >= 2, 30000, "ikkinchi rasm");
    assert(
      mock.photos[1].caption.includes("katak daftar"),
      `yangi sozlama qo'llandi: "${mock.photos[1].caption.split("\n")[0]}"`,
    );

    console.log("\n=== 3-holat: /file buyrug'i (PNG fayl) ===");
    mock.push({
      update_id: 4,
      message: { message_id: 4, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/file" },
    });
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("PNG fayl")), 15000, "/file tasdiqi");
    mock.push({
      update_id: 5,
      message: { message_id: 5, chat: { id: TEST_CHAT_ID, type: "private" }, text: "Qisqa matn: √16 = 4" },
    });
    await waitFor(() => mock.calls.filter((call) => call === "sendDocument").length >= 1, 30000, "fayl yuborildi");
    assert(true, "/file rejimida natija sendDocument orqali yuborildi");

    console.log("\n=== 4-holat: shriftlar kutubxonasi ===");

    // Avvalgi holat `/file` rejimini yoqqan edi — rasm rejimiga qaytaramiz.
    mock.push({
      update_id: 5.5 as unknown as number,
      message: { message_id: 55, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/file" },
    });
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("rasm sifatida")),
      15000,
      "rasm rejimiga qaytish",
    );
    assert(true, "/file yana bosilganda rasm rejimiga qaytdi");

    mock.push({
      update_id: 6,
      message: { message_id: 6, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/fonts" },
    });
    await waitFor(
      () => mock.texts.some((entry) => entry.text.includes("Marck Script") && entry.text.includes("Caveat")),
      15000,
      "/fonts ro'yxati",
    );
    const fontsMessage = mock.texts.filter((entry) => entry.text.includes("Marck Script")).pop();
    assert(
      Boolean(fontsMessage) && fontsMessage!.text.length < 4096,
      `/fonts ro'yxati Telegram chegarasidan oshmadi (${fontsMessage?.text.length ?? 0} belgi)`,
    );
    assert(
      (fontsMessage?.text.match(/^[a-z]+ —/gm) ?? []).length >= 20,
      "/fonts ro'yxatida kamida 20 shrift qatori bor",
    );

    mock.push({
      update_id: 7,
      message: { message_id: 7, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/font badscript" },
    });
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Bad Script")), 15000, "/font tasdiqi");
    assert(true, "/font badscript buyrug'i shriftni almashtirdi");

    const beforeScript = mock.photos.length;
    mock.push({
      update_id: 8,
      message: { message_id: 8, chat: { id: TEST_CHAT_ID, type: "private" }, text: "Привет, 2026 x^2" },
    });
    await waitFor(() => mock.photos.length > beforeScript, 30000, "badscript bilan rasm");
    const scriptPhoto = mock.photos[mock.photos.length - 1];
    assert(
      scriptPhoto.caption.includes("Bad Script"),
      `yangi shrift keyingi rasmga qo'llandi: "${scriptPhoto.caption.split("\n")[0]}"`,
    );
    assert(
      mock.calls.filter((call) => call === "sendPhoto").length >= 3,
      "rasm rejimida sendPhoto ishlatildi",
    );

    mock.push({
      update_id: 9,
      message: { message_id: 9, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/font shunaqashrift" },
    });
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("/fonts")), 15000, "xato id uchun javob");
    assert(true, "noto'g'ri shrift id'siga tushunarli javob berildi");

    mock.push({
      update_id: 10,
      message: { message_id: 10, chat: { id: TEST_CHAT_ID, type: "private" }, text: "/font caveatbrush" },
    });
    await waitFor(() => mock.texts.some((entry) => entry.text.includes("Caveat Brush")), 15000, "/font caveatbrush");
    const beforeCyrillic = mock.photos.length;
    mock.push({
      update_id: 11,
      message: { message_id: 11, chat: { id: TEST_CHAT_ID, type: "private" }, text: "Привет, бу русча матн" },
    });
    await waitFor(() => mock.photos.length > beforeCyrillic, 30000, "kirillsiz shrift bilan rasm");
    const cyrillicPhoto = mock.photos[mock.photos.length - 1];
    assert(
      cyrillicPhoto.caption.includes("kirill"),
      `kirillsiz shriftda kirill ogohlantirishi qo'shildi: "${cyrillicPhoto.caption.split("\n").slice(-1)[0]}"`,
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
  console.log("\nBot tekshiruvi o'tdi: matn → qo'lyozma rasm → Telegram.");
}

main().catch((error) => {
  console.error("BOT TEKSHIRUVI YIQILDI:", error instanceof Error ? error.message : error);
  process.exit(1);
});
