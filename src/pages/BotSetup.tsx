import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Info,
  NotebookPen,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Nusxa olish bloki                                                   */
/* ------------------------------------------------------------------ */

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-ink/15 bg-ink/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 bg-white/60 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-pencil/60">
          {label ?? "terminal"}
        </span>
        <button
          type="button"
          onClick={copy}
          title={copied ? "Nusxa olindi" : "Nusxa olish"}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
            copied ? "bg-sage-soft text-sage" : "text-ink/70 hover:bg-ink/10 hover:text-ink",
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Nusxa olindi" : "Nusxa olish"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[13px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kichik yordamchi bloklar                                            */
/* ------------------------------------------------------------------ */

function StepCard({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-14">
      <span className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl border border-ink/15 bg-white text-base font-bold text-ink shadow-note">
        {index}
      </span>
      <Card className="mb-6">
        <CardHeader className="mb-3">
          <CardTitle className="hand text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-pencil/85">{children}</CardContent>
      </Card>
    </div>
  );
}

function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  const Icon = tone === "warn" ? ShieldAlert : Info;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border p-3.5 text-sm",
        tone === "warn" ? "border-margin/30 bg-margin-soft/25 text-ink" : "border-sage/25 bg-sage-soft/60 text-ink",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "warn" ? "text-margin" : "text-sage")} />
      <div>
        <p className="font-semibold">{title}</p>
        <div className="mt-1 leading-relaxed text-pencil/85">{children}</div>
      </div>
    </div>
  );
}

function CommandTable({ rows }: { rows: { code: string; text: string }[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink/12">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-paper-deep/70 text-[11px] uppercase tracking-wide text-pencil/60">
          <tr>
            <th className="px-3.5 py-2.5 font-semibold">Buyruq</th>
            <th className="px-3.5 py-2.5 font-semibold">Nima qiladi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="border-t border-ink/10 bg-white/50 align-top">
              <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[13px] font-semibold text-ink">
                {row.code}
              </td>
              <td className="px-3.5 py-2.5 text-pencil/85">{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ma'lumotlar                                                         */
/* ------------------------------------------------------------------ */

const botCommands = [
  { code: "/start", text: "Salomlashadi va pastdagi doimiy menyuni chiqaradi: ✍️ Matn kiritish va ⚙️ Sozlamalar." },
  { code: "/help", text: "Buyruqlar va matematika sintaksisi eslatmasi (menyu ham qoladi)." },
  { code: "/settings", text: "Sozlamalar menyusini ochadi: siyoh rangi, qog'oz turi, yozuv uslubi, yozuv sozlamalari, daftarlar va o'z qo'lyozmangizni nusxalash." },
  { code: "/lined", text: "Yo'l-yo'l (chiziqli) daftar — adabiyot, insho, diktant uchun." },
  { code: "/grid", text: "Katak daftar — matematika, algebra, geometriya uchun." },
  { code: "/plain", text: "Toza (chiziqsiz) oq varaq — A4 o'lchamda." },
  { code: "/blue /black /graphite", text: "Siyoh rangini tanlash: ko'k, qora yoki qalam." },
  { code: "/green /red /purple", text: "Yashil, qizil va siyohrang siyohlar." },
  { code: "/orange /pink", text: "To'q sariq va pushti siyohlar." },
  { code: "/teal /brown", text: "Havorang va jigarrang — jami 10 ta rang." },
  { code: "/caveat", text: "Erkin qo'lyozma uslubi (Caveat) — tez yozilgan daftar." },
  { code: "/marck", text: "Chiroyli qo'lyozma uslubi (Marck Script) — ozoda yozuv." },
  { code: "/font <id>", text: "Yozuv shriftini almashtiradi — 39 shriftdan birini tanlang, masalan /font badscript." },
  { code: "/fonts", text: "Shriftlar ro'yxatini ko'rsatadi — har bir nom o'z shriftida chizilgan rasm ko'rinishida (Telegram shriftlarni ko'rsata olmaydi)." },
  { code: "/style", text: "«Uslubimni nusxalash» bo'limini ochadi: o'z qo'lyozmangizni namunadan o'lchab, shaxsiy uslub yasaydi (/uslub ham ishlaydi)." },
  { code: "/size 34", text: "Yozuv o'lchamini o'zgartirish (26–52 oralig'ida)." },
  { code: "/file", text: "Natijani rasm sifatida emas, PNG fayl sifatida yuborish rejimini yoqadi/o'chiradi." },
  { code: "/id", text: "Chat ID'ni ko'rsatadi — botni alohida chat yoki guruhga ulashda yordam beradi." },
];

const suggestedFonts = [
  { code: "caveat", text: "Erkin qo'lyozma — kundalik daftar uslubi, kirillcha ishlaydi (standart)." },
  { code: "marckscript", text: "Ozoda yozuv — diktant va nazorat ishi uchun, kirillcha ishlaydi." },
  { code: "badscript", text: "Ingichka ozoda yozuv — uzun matnlarga qulay, kirillcha ishlaydi." },
  { code: "neucha", text: "Bosma (pechat) uslub — harflar alohida-alohida, kirillcha ishlaydi." },
  { code: "patrickhand", text: "O'quvchi daftari uslubi — faqat lotin (o'zbek) matni uchun." },
  { code: "dancingscript", text: "Kitobiy kursiv — chiroyli, tantanali yozuv, faqat lotin matni." },
  { code: "pangolin", text: "Bolalar yozuvi — yumaloq quvnoq harflar, kirillcha ishlaydi." },
  { code: "lobster", text: "Qalin mo'yqalam uslubi — sarlavha va e'lonlar uchun, kirillcha ishlaydi." },
];

const mathSyntax = [
  { code: "x^2, x^{10}", text: "Yuqori indeks (daraja) — 2 yoki 10 kichik shriftda yuqoriga ko'tariladi." },
  { code: "a_1, a_{n+1}", text: "Quyi indeks — 1 yoki n+1 pastga tushiriladi." },
  { code: "\\frac{a}{b}", text: "Kasr: a surat, b maxraj, orasida chizilgan kasr chizig'i." },
  { code: "$a/b$", text: "Matematik rejimdagi qisqa kasr (ikki tomon ham oddiy ifoda bo'lsa)." },
  { code: "\\sqrt{x}", text: "Kvadrat ildiz — ildiz belgisi va ustki chiziq ostida x." },
  { code: "\\sqrt[3]{x}", text: "Kub ildiz (ixtiyoriy daraja ko'rsatkichi bilan)." },
  { code: "√ ∫ ∑ ± × ÷", text: "Belgilar to'g'ridan-to'g'ri matn sifatida ham yoziladi." },
  { code: "≤ ≥ ≠ ≈ ∞ π °", text: "Taqqoslash va geometriya belgilari." },
  { code: "∠ ⊥ ∥ → ⇒", text: "Geometriya va mantiq belgilari." },
  { code: "α β γ θ λ μ ∆", text: "Yunon harflari." },
];

const envVars = [
  { code: "TELEGRAM_BOT_TOKEN", text: "Majburiy. @BotFather bergan token." },
  { code: "BOT_SECRET", text: "Ixtiyoriy. Webhook uchun maxfiy kalit (faqat webhook rejimida)." },
  { code: "PORT", text: "Ixtiyoriy. Webhook server porti, standart 8080." },
  { code: "BOT_DATA_DIR", text: "Ixtiyoriy. Sozlamalar, daftarlar va shaxsiy uslublar saqlanadigan papka: settings.json, notebooks.json, styles.json (standart ./bot/data)." },
  {
    code: "TELEGRAM_API_BASE",
    text: "Ixtiyoriy. O'z Bot API serveringiz yoki test uchun API manzili (standart https://api.telegram.org).",
  },
];

const troubleshooting = [
  {
    code: "401 Unauthorized",
    text: "Token xato yoki o'chirilgan. @BotFather'dan tokenni qayta oling va TELEGRAM_BOT_TOKEN qiymatini yangilang.",
  },
  {
    code: "409 Conflict",
    text: "Polling va webhook bir vaqtda ishlayapti. `bun bot/index.ts delete-webhook` buyrug'ini bajaring yoki webhook rejimini to'xtatib, faqat bittasini qoldiring.",
  },
  { code: "text tushmayapti", text: "Faqat matn va `$...$` ichidagi formulalar qayta ishlanadi; ovozli xabar va rasmlar hozircha qo'llanmaydi." },
  { code: "Juda uzun javob", text: "Matn bir necha varaqqa bo'linadi va har bir varaq alohida rasm qilib yuboriladi." },
  { code: "Belgi topilmadi", text: "Agar belgi shriftda bo'lmasa, bot javobiga ogohlantirish qo'shiladi; belgini boshqa usulda yozib ko'ring." },
  {
    code: "daftar yo'q",
    text: "`✍️ Matn kiritish` daftar yo'qligini aytsa, `➕ Yangi daftar` bilan 12/36/48/96 varaqdan birini tanlab daftar yarating.",
  },
  {
    code: "Matn yozilmayapti",
    text: "Matn faqat ochiq daftarga yoziladi: `📚 Daftarlar` bo'limidan daftarni tanlang (yoki `✍️ Matn kiritish`), keyin matn yuboring.",
  },
];

/* ------------------------------------------------------------------ */

export default function BotSetup() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl px-5 pb-10 pt-10">
        <div className="animate-ink-in">
          <Badge tone="marker">
            <NotebookPen className="h-3.5 w-3.5" />
            5 daqiqada ishga tushirish
          </Badge>
          <h1 className="hand mt-4 text-4xl leading-tight text-ink sm:text-5xl">
            Telegram botni ulash
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-pencil/85">
            Bot Studio bilan bir xil qo'lyozma dvigatelidan foydalanadi. U pastdagi menyu bilan
            boshqariladi: avval daftar yaratasiz (12/36/48/96 varaq), keyin matn yuborasiz — yozuv
            varaqma-varaq, xuddi haqiqiy daftardek chiqadi. Quyidagi qadamlarni ketma-ket bajaring.
          </p>
        </div>

        <div className="mt-8">
          <Card className="mb-8 border-sage/25 bg-sage-soft/40">
            <CardHeader className="mb-2">
              <CardTitle className="text-base">Nega bu sahifada akkaunt yo'q?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-pencil/85">
              Daftar Bot butunlay brauzerda va sizning kompyuteringizda ishlaydi: Studio hech qanday
              serverga matn yubormaydi, bot esa siz ishga tushiradigan jarayon. Shu sababli ro'yxatdan
              o'tish, parol yoki profil kerak emas — hech qanday ma'lumot bizga saqlanmaydi.
            </CardContent>
          </Card>

          <StepCard index={1} title="@BotFather bilan bot yaratish">
            <p>
              Telegramda{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-ink underline decoration-marker/60 decoration-2 underline-offset-2"
              >
                @BotFather
              </a>{" "}
              ni oching va <code className="rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[13px]">/newbot</code>{" "}
              buyrug'ini yuboring. Navbat bilan:
            </p>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>botning ko'rinadigan nomi (masalan, <em>Daftar Yozuvchi</em>);</li>
              <li>
                username — u <code className="font-mono text-[13px]">bot</code> bilan tugashi shart
                (masalan, <code className="font-mono text-[13px]">mening_daftar_bot</code>).
              </li>
            </ul>
            <p>
              BotFather javobida HTTP API token bo'ladi — u quyidagicha ko'rinadi:
            </p>
            <CodeBlock label="token namunasi" code={"7123456789:AAH9pQwErTyUiOpAsDfGhJkLzXcVbNmQrS"} />
            <Notice tone="warn" title="Tokenni hech kimga bermang">
              Token — botning kaliti. Uni kodga yozmang, chatga tashlamang va ekranga chiqarmang.
              Token oshkor bo'lsa, @BotFather orqali <code className="font-mono">/revoke</code> qilib
              yangisini oling.
            </Notice>
          </StepCard>

          <StepCard index={2} title="Tokenni loyihaga qo'shish">
            <p>
              Freebuff'da chap paneldagi <strong>Settings → Environment (Keys)</strong> bo'limiga
              o'ting va quyidagi kalitni qo'shing:
            </p>
            <CodeBlock label="kalit nomi" code={"TELEGRAM_BOT_TOKEN"} />
            <p>
              Loyihani o'z kompyuteringizda ishga tushirayotgan bo'lsangiz, loyiha ildizidagi{" "}
              <code className="font-mono text-[13px]">.env</code> fayliga yozing:
            </p>
            <CodeBlock label=".env" code={"TELEGRAM_BOT_TOKEN=7123456789:AAH9pQwErTyUiOpAsDfGhJkLzXcVbNmQrS"} />
            <Notice tone="warn" title=".env faylini git'ga qo'shmang">
              Maxfiy kalitlar repozitoriyga tushmasligi kerak. Loyihada{" "}
              <code className="font-mono text-[13px]">.env</code> allaqachon e'tiborsiz fayllar
              ro'yxatida bo'lishi kerak — tekshirib qo'ying.
            </Notice>
            <div className="mt-2">
              <CommandTable rows={envVars} />
            </div>
          </StepCard>

          <StepCard index={3} title="Botni ishga tushirish">
            <p className="text-pencil/70">
              Token muvaffaqiyatli o'qilganini avval shu buyruq bilan tekshirib olishingiz mumkin:{" "}
              <code className="font-mono text-[13px]">bun bot/index.ts info</code> bot nomini va webhook
              holatini ko'rsatadi.
            </p>
            <p>
              Eng sodda yo'l — <strong>polling</strong>: bot Telegram'dan yangiliklarni o'zi so'rab
              turadi, shuning uchun hosting yoki domen shart emas. Loyiha ildizida bajaring:
            </p>
            <CodeBlock label="terminal" code={"bun run bot:poll"} />
            <p className="text-pencil/70">
              Xuddi shu narsa: <code className="font-mono text-[13px]">bun bot/index.ts poll</code>. Terminal
              ochiq turishi kerak — bot shu jarayonda ishlaydi.
            </p>
            <p className="pt-1">
              Doimiy server (masalan, Railway, Render yoki o'z VPS'ingiz) bo'lsa, <strong>webhook</strong>{" "}
              rejimida ishlatish tezroq:
            </p>
            <CodeBlock label="terminal" code={"bun bot/index.ts webhook https://mening-domenim.example"} />
            <p className="text-pencil/70">
              Bot <code className="font-mono text-[13px]">https://mening-domenim.example/telegram/webhook</code>{" "}
              manzilini Telegram'ga ro'yxatdan o'tkazadi va <code className="font-mono text-[13px]">PORT</code>{" "}
              (standart 8080) portida tinglaydi. Domen HTTPS bo'lishi shart.
            </p>
            <p>Holatni tekshirish va webhook'ni o'chirish:</p>
            <CodeBlock label="terminal" code={"bun bot/index.ts info\nbun bot/index.ts delete-webhook"} />
            <Notice tone="info" title="Botni doimiy ishlatish (o'z serveringiz)">
              Kompyuteringiz o'chsa, terminaldagi bot ham to'xtaydi. Doimiy ishlashi uchun loyihadagi{" "}
              <code className="font-mono text-[13px]">deploy/</code> papkasidagi skript botni systemd
              xizmati sifatida o'rnatadi (Bun, kerakli paketlar, alohida foydalanuvchi, avtomatik qayta
              ishga tushish — hammasi tayyor):
              <CodeBlock label="server (root)" code={"sudo bash deploy/deploy.sh"} />
              Qadam-baqadam qo'llanma (SSH, token, nginx, yangilash) —{" "}
              <code className="font-mono text-[13px]">deploy/README.md</code> faylida.
            </Notice>
          </StepCard>

          <StepCard index={4} title="Sozlash: pastdagi menyu">
            <p>
              Botdagi natija Studio'dagi bilan bir xil dvigatel orqali chiziladi — ya'ni{" "}
              <Link to="/studio" className="font-semibold text-ink underline decoration-marker/60 decoration-2 underline-offset-2">
                Studioda
              </Link>{" "}
              ko'rganingiz aynan botda ham chiqadi.
            </p>
            <p>
              Tugmalar endi chat ichida emas, matn yoziladigan qatorning tagida turadi:{" "}
              <code className="font-mono text-[13px]">⚙️ Sozlamalar</code> ni bosing va har bir bo'limni
              alohida ochib sozlang.
            </p>
            <CommandTable
              rows={[
                {
                  code: "🖋 Siyoh rangi",
                  text: "10 ta rang: ko'k, qora, qalam, yashil, qizil, siyohrang, to'q sariq, pushti, havorang, jigarrang. Joriysi ✓ bilan belgilanadi.",
                },
                {
                  code: "📄 Qog'oz turi",
                  text: "Yo'l-yo'l (chiziqli), Katak (5 mm) va Toza — uchtasi ham A4 o'lchamda.",
                },
                {
                  code: "✍️ Yozuv uslubi",
                  text: "39 shriftdan birini tanlash; ro'yxat sahifalab, har bir nom o'z shriftida chizilgan rasm ko'rinishida chiqadi.",
                },
                {
                  code: "📐 Yozuv sozlamalari",
                  text: "O'lcham, qo'l tebranishi, qator oralig'i, matematika rejimi va natijani rasm yoki PNG fayl qilib yuborish.",
                },
                {
                  code: "📚 Daftarlar",
                  text: "Daftarlar ro'yxati va yangi daftar yaratish; daftar tugmasi bosilsa karta ochiladi — yozish, PDF qilib yuklab olish va nomini o'zgartirish.",
                },
                {
                  code: "🖋 Uslubimni nusxalash",
                  text: "O'z qo'lyozmangizni nusxalash: 1-qadamda 10 ta so'z, 2-qadamda 10 ta raqam namunasi suratga olinadi, bot o'lchab qo'lingizga yaqin uslub yasaydi — u faqat sizga ko'rinadi.",
                },
              ]}
            />
            <Badge tone="sage">Maslahat: adabiyot uchun Yo'l-yo'l + Marck Script, matematika uchun Katak + Caveat</Badge>

            <p className="pt-2 font-semibold text-ink">Yozuv shriftini tanlash (39 xil qo'lyozma)</p>
            <p>
              Har bir shrift boshqa odamning qo'li bilan yozilgandek ko'rinadi: erkin qo'lyozma, ozoda
              yozuv, bosma (pechat) uslub, kitobiy kursiv, mo'yqalam va bo'r, bolalar yozuvi. To'liq
              ro'yxatni botdan so'raysiz:
            </p>
            <CodeBlock label="Telegram" code={"/fonts"} />
            <p>
              Ro'yxatdagi <code className="font-mono text-[13px]">id</code> bilan shriftni
              almashtirasiz — keyingi barcha rasmlar shu uslubda chiqadi:
            </p>
            <CodeBlock label="Telegram" code={"/font badscript"} />
            <CommandTable rows={suggestedFonts} />
            <Notice tone="warn" title="Kirillcha matn (rus tili)">
              Kutubxonadagi 13 shrift kirill alifbosini to'liq biladi. Agar tanlangan shriftda kirill
              harfi bo'lmasa, o'sha harflar zaxira shriftda (Caveat) chiziladi va bot bu haqda bir marta
              ogohlantiradi — matn yo'qolmaydi, ammo bir xil uslub uchun kirillcha biladigan shriftni
              tanlagan ma'qul.
            </Notice>
            <p className="text-pencil/70">
              Xuddi shu 39 shriftni Studio'dagi shrift galereyasida ko'rib, jonli namunasini
              solishtirishingiz mumkin — bot aynan o'sha shriftlarni ishlatadi.
            </p>

            <p className="pt-2 font-semibold text-ink">O'z qo'lyozmangizni nusxalash</p>
            <p>
              Bot <code className="font-mono text-[13px]">🖋 Uslubimni nusxalash</code> bo'limida o'z
              qo'lingizga moslanadi: u 39 shrift ichidan eng yaqinini topib, uni sizning
              o'lchovlaringiz bilan chizadi — natijada yozuv ommaviy shrift emas, sizning qo'lyozmangiz
              bo'ladi.
            </p>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>
                <strong>1-qadam — so'zlar.</strong> Yo'l-yo'l daftar varaqasiga 10 ta so'zni (
                <em>salom, maktab, daftar, kitob, qalam, yozuv, o'qituvchi, do'stlik, quyosh, bahor</em>)
                o'zgartirmasdan, odatdagidek yozib suratga olasiz.
              </li>
              <li>
                <strong>2-qadam — raqamlar.</strong> Katak daftarga 10 ta raqamni (<em>0 1 2 3 4 5 6 7 8 9</em>)
                yozasiz yoki{" "}
                <code className="font-mono text-[13px]">⏭ Raqamlarsiz davom etish</code> bilan bu qadamni
                o'tkazib yuborasiz — u holda uslub faqat so'zlar o'lchovidan hisoblanadi.
              </li>
              <li>
                <strong>3-qadam — nom.</strong> Bot qiyalik, shtrix qalinligi, harflar kengligi va orasini
                o'lchab, namunaga eng yaqin shriftni tanlaydi. So'ng uslubga nom berasiz;{" "}
                <code className="font-mono text-[13px]">⏭ Nomsiz qoldirish</code> bosilsa u <em>«Mening
                uslubim»</em> deb saqlanadi va darhol yoqiladi.
              </li>
            </ol>
            <p>Bo'limni ochish uchun shu buyruq ham yetadi:</p>
            <CodeBlock label="Telegram" code={"/style"} />
            <CommandTable
              rows={[
                {
                  code: "▶️ Namunani boshlash",
                  text: "Yangi namuna olishni boshlaydi: 1-qadam — 10 ta so'z, 2-qadam — 10 ta raqam.",
                },
                {
                  code: "✒️ Mening qo'lyozmam",
                  text: "Saqlangan uslubni yoqadi — bundan keyin barcha varaqalar va ⬇️ PDF kitob shu uslubda chiziladi.",
                },
                {
                  code: "⏹ Uslubni to'xtatish",
                  text: "Uslubni vaqtincha o'chiradi va ommaviy shriftlarga qaytaradi; uslub bazada qoladi.",
                },
                {
                  code: "🗑 Uslubni o'chirish",
                  text: "Uslubni butunlay o'chiradi; bir nechta uslub saqlangan bo'lsa, qaysi birini o'chirishni so'raydi.",
                },
                {
                  code: "❌ Bekor qilish",
                  text: "Namuna olishni yoki o'chirishni bekor qiladi (saqlangan uslublarga tegmaydi).",
                },
              ]}
            />
            <Notice tone="warn" title="Namuna surati qanday bo'lishi kerak">
              Varaqni to'rt burchagi bilan, yorug' joyda va to'liq ko'rinadigan qilib suratga oling. Yozuvni
              chiroyli qilib ko'chirish shart emas — o'z qo'lingiz bilan tabiiy yozilgani yaxshiroq o'qiladi.
              Bot o'qib bo'lmasa yoki siyoh juda kam bo'lsa, qayta suratga olishni so'raydi.
            </Notice>
            <Notice tone="info" title="Uslub faqat sizga ko'rinadi">
              Saqlangan uslublar chatga bog'lanadi: boshqa foydalanuvchi ularni na ro'yxatda, na chizmada
              ko'radi. Bitta chatda ko'pi bilan <strong>5 ta uslub</strong> turadi — yangisiga joy ochish
              uchun keraksizini <code className="font-mono text-[13px]">🗑 Uslubni o'chirish</code> bilan
              o'chirasiz. Ma'lumotlar{" "}
              <code className="font-mono text-[13px]">BOT_DATA_DIR</code> papkasidagi{" "}
              <code className="font-mono text-[13px]">styles.json</code> faylida saqlanadi, ommaviy
              shriftlar esa <code className="font-mono text-[13px]">✍️ Yozuv uslubi</code> bo'limida o'z
              holida qoladi.
            </Notice>
          </StepCard>

          <StepCard index={5} title="Daftar yaratish, nomlash va matn yozish">
            <p>
              Yozishdan oldin daftar kerak: <code className="font-mono text-[13px]">➕ Yangi daftar</code> ni
              bosing va varaq sonini tanlang — <strong>12</strong>, <strong>36</strong>, <strong>48</strong> yoki{" "}
              <strong>96 varaq</strong>. Har varaqning ikki tomoni bo'ladi, ya'ni jami 24/72/96/192 bet.
            </p>
            <p>
              Varaq soni tanlangach bot <strong>daftar nomini so'raydi</strong>: nomni oddiy matn qilib
              yuboring — masalan <em>"Matematika 8-sinf"</em>. Nom kerak bo'lmasa{" "}
              <code className="font-mono text-[13px]">⏭ Nomsiz qoldirish</code> ni bosing va daftar
              standart nom bilan ochiladi (<code className="font-mono text-[13px]">1-daftar</code>, keyingisi{" "}
              <code className="font-mono text-[13px]">2-daftar</code>).
            </p>
            <CommandTable
              rows={[
                {
                  code: "✍️ Matn kiritish",
                  text: "Daftarlar ro'yxatini chiqaradi va tanlangan daftarni ochadi. Daftar hali bo'lmasa, avval yangi daftar yaratish kerakligini aytadi.",
                },
                {
                  code: "📖 1-daftar • 5/24",
                  text: "Daftar tugmasi: nomi va nechta bet band qilinganini ko'rsatadi.",
                },
                {
                  code: "✏️ yangi nom",
                  text: "Daftar nomini keyin ham o'zgartirasiz: daftar kartasidagi ✏️ Nomini o'zgartirish bosilgach yangi nomni matn qilib yuboring.",
                },
                {
                  code: "yuborilgan matn",
                  text: "Tanlangan daftarga varaqma-varaq yoziladi va har bir tomon alohida rasm bo'lib qaytadi.",
                },
              ]}
            />
            <Notice tone="info" title="Xuddi haqiqiy daftardek">
              Varaqning <strong>old tomonida</strong> qizil chegara chapda, <strong>orqa tomonida</strong> esa
              o'ngda bo'ladi — yozuv varaqdan varaqqa shu tartibda davom etadi. Daftar varaqlari tugaganda bot
              yangi daftar yaratishni aytadi.
            </Notice>
            <p className="pt-2 font-semibold text-ink">Daftar kartasi va kitobdek yuklab olish</p>
            <p>
              <code className="font-mono text-[13px]">📚 Daftarlar</code> bo'limida daftar tugmasi bosilsa
              uning kartasi ochiladi — har bir amal alohida tugmada:
            </p>
            <CommandTable
              rows={[
                {
                  code: "✍️ Shu daftarga yozish",
                  text: "Yozish joyini so'raydi: oxirgi yozuv joyi va betdagi bo'sh qatorlar soni ko'rsatiladi, so'ng ▶️ Davom etish / 🔢 Qatorni tanlash / ➕ Yangi betdan tanlanadi va nechta qator tashlab ketish so'raladi.",
                },
                {
                  code: "⬇️ PDF yuklab olish",
                  text: "Daftarning barcha yozilgan betlarini A4 ko'p betli bitta PDF kitob qilib yuboradi (fayl: <daftar nomi>.pdf). Juda katta daftarda PDF bir necha qismga bo'linadi (-1-qism, -2-qism, …).",
                },
                {
                  code: "🛠 Tahrirlash",
                  text: "Tahrirlash menyusi: ✂️ Yozuvni o'chirish — yozilgan betlar slayd qilinadi, bet → qator → so'z tanlanib, oraliq tasdiqlangach o'sha so'zlar o'chiriladi; ↩️ Oxirgi amalni qaytarish — oxirgi yozuv yoki o'chirishni bekor qiladi.",
                },
                {
                  code: "✏️ Nomini o'zgartirish",
                  text: "Daftarga yangi nom berish — yangi nomni keyingi xabar qilib yuborasiz.",
                },
                { code: "⬅️ Daftarlar", text: "Ro'yxatga qaytish." },
              ]}
            />
            <Notice title="Kitobdek, varaqma-varaq">
              PDF'da har bir bet alohida A4 sahifa: old tomonida chegara chapda, orqa tomonida o'ngda —
              yuklab olgan kitobingiz terilgan daftar kabi varaqma-varaq o'qiladi. PDF har doim hujjat
              (fayl) sifatida keladi, ya'ni{" "}
              <code className="font-mono text-[13px]">🖼 Yuborish turi</code> sozlamasiga bog'liq emas.
            </Notice>
          </StepCard>

          <StepCard index={6} title="Buyruqlar va matematika sintaksisi">
            <p className="font-semibold text-ink">Bot buyruqlari</p>
            <CommandTable rows={botCommands} />
            <p className="pt-4 font-semibold text-ink">Matematika yozuvi</p>
            <CommandTable rows={mathSyntax} />
            <p className="pt-3 text-pencil/70">
              Oddiy matn shunchaki yozilsa ham yetadi: bot qatorlarni saqlab, chegaraga yetganda so'zni
              keyingi qatorga ko'chiradi.
            </p>
          </StepCard>

          <StepCard index={7} title="Muammolar va yechimlar">
            <CommandTable rows={troubleshooting} />
            <p className="pt-3">
              Yordam kerak bo'lsa, avval{" "}
              <code className="font-mono text-[13px]">bun bot/index.ts info</code> natijasini tekshiring —
              u bot nomini va webhook holatini ko'rsatadi.
            </p>
          </StepCard>
        </div>

        <div className="paper-lined mt-6 rounded-2xl border border-paper-edge p-6 shadow-paper">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="hand text-3xl text-ink">Tokenni oldingizmi? Endi sinab ko'ring</h2>
              <p className="mt-1 text-sm text-pencil/80">
                Studio'da matnni yozib, natijani darhol ko'ring — bot ham xuddi shunday chizadi.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Link
                to="/studio"
                className={cn(buttonVariants({ variant: "default" }), "gap-2")}
              >
                <Terminal className="h-4 w-4" />
                Studio'ni ochish
              </Link>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-ink/20 bg-white/70 px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-ink/40"
              >
                BotFather
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-pencil/60">
            <ArrowRight className="h-3.5 w-3.5" />
            Buyruqlar ro'yxati va batafsil qo'llanma <code className="font-mono">Readme.md</code> faylida ham bor.
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
