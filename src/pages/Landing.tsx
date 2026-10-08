import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpenText,
  Grid3x3,
  PenLine,
  Sigma,
  Sparkles,
  SquareFunction,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { PaperMock } from "@/components/paper-mock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/controls";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: PenLine,
    title: "Matn → qo'lyozma",
    text: "Yuborgan matningiz chiziq ustiga tekis o'tiradi, harflar esa biroz egri-bugri — xuddi qo'lda yozgandek.",
  },
  {
    icon: Grid3x3,
    title: "Yo'l-yo'l va katak",
    text: "Bir buyruq bilan chiziqli yoki katak daftarni tanlaysiz, siyoh rangini va yozuv uslubini o'zgartirasiz.",
  },
  {
    icon: Sparkles,
    title: "O'z qo'lyozmangiz",
    text: "10 ta so'z va 10 ta raqamni qog'ozga yozib suratga olasiz — bot qo'lingizni o'lchab, keyingi barcha varaqalarni shu uslubda yozadi.",
  },
  {
    icon: SquareFunction,
    title: "Matematika ham ishlaydi",
    text: "Kasr, daraja, indeks va ildizlar o'z joyiga tushadi: x^2, a_1, \\frac{a}{b}, \\sqrt{x}.",
  },
];

const steps = [
  {
    title: "@BotFather'dan token oling",
    text: "Telegramda @BotFather ga /newbot buyrug'ini yozib, yangi bot yaratasiz va uning tokenini olasiz.",
  },
  {
    title: "Botni ulang",
    text: "Tokenni sozlamalarga qo'shib, botni ishga tushirasiz — qadamma-qadam qo'llanma /bot sahifasida.",
  },
  {
    title: "Matnni yuboring",
    text: "Botga she'r, insho, diktant matni yoki tenglama va misollarni yozib yuborasiz.",
  },
  {
    title: "Rasmni oling",
    text: "Bir necha soniyada daftar varaqasidagi qo'lyozma rasmi tayyor — yuklab olish yoki chop etish mumkin.",
  },
];

const syntax = [
  { code: "x^2", note: "daraja" },
  { code: "a_1", note: "indeks" },
  { code: "\\frac{a}{b}", note: "kasr" },
  { code: "\\sqrt{x}", note: "ildiz" },
];

const samples = [
  {
    variant: "lined" as const,
    ink: "#1B3E8F",
    title: "Sana: 12.10.2026   Mavzu: Ona tili",
    lines: ["Bahor keldi. Tog'lar", "ko'm-ko'k yashil libos", "kiydi, dalalar gulga"],
    caption: "Adabiyot — insho va diktant matni",
  },
  {
    variant: "grid" as const,
    ink: "#1F1F26",
    title: "Mavzu: Kasrlar",
    lines: ["1/2 + 1/3 = 5/6", "3/4 : 1/8 = 6", "Javob: 5/6 va 6"],
    caption: "Matematika — kasrlar katak daftarda",
  },
  {
    variant: "grid" as const,
    ink: "#1F6B4A",
    title: "Mavzu: Geometriya",
    lines: ["S = a · b = 7 · 4", "S = 28 sm^2", "P = 2 · (7 + 4) = 22"],
    caption: "Geometriya — formula va hisoblar",
  },
];

const faqs = [
  {
    question: "Bot qaysi fanlar uchun mos?",
    answer:
      "Adabiyot, ona tili va boshqa yozma fanlar uchun yo'l-yo'l daftar, matematika, algebra va geometriya uchun katak daftar mos keladi. Ikkalasini bitta botda almashtirib ishlatasiz.",
  },
  {
    question: "Uzun matn bilan nima bo'ladi?",
    answer:
      "Matn varaqqa sig'masa, bot uni avtomatik ravishda bir necha varaqqa bo'lib yuboradi — xuddi daftarni varaqlagandek ketma-ket keladi.",
  },
  {
    question: "Internet uzilsa yoki oflayn bo'lsam bo'ladimi?",
    answer:
      "Rasm yaratish uchun qisqa vaqt ichida javob qaytariladi, shuning uchun barqaror aloqa tavsiya etiladi. Studio esa to'liq brauzerda ishlaydi — matn hech qayerga yuborilmaydi.",
  },
  {
    question: "O'z qo'lyozmamni botga o'rgatsam bo'ladimi?",
    answer:
      "Ha. «🖋 Uslubimni nusxalash» bo'limida 1-qadamda 10 ta so'zni yo'l-yo'l daftarga, 2-qadamda 10 ta raqamni katak daftarga yozib suratga olasiz (raqamlarni o'tkazib yuborish ham mumkin). Bot eng yaqin shriftni tanlab, o'lchovlaringizni — qiyalik, shtrix qalinligi, harflar orasi — ustiga qo'yadi. Uslub faqat sizga ko'rinadi va bir chatda ko'pi bilan 5 tasi saqlanadi.",
  },
  {
    question: "Sozlamalarni qanday o'zgartiraman?",
    answer:
      "Botda /lined yoki /grid buyruqlari daftar turini, /blue yoki /black siyoh rangini, /caveat va /marck yozuv uslubini o'zgartiradi. Studioda esa hammasi tugmalar orqali boshqariladi.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                             */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <div className="animate-ink-in">
              <Badge tone="marker">
                <Sparkles className="h-3.5 w-3.5" />
                Telegram bot · chiziqli va katak daftar
              </Badge>
            </div>

            <h1
              className="hand animate-ink-in mt-5 text-5xl leading-[1.05] text-ink sm:text-6xl lg:text-7xl"
              style={{ animationDelay: "80ms" }}
            >
              Matnni yuboring —
              <br />
              <span className="ink-underline">daftarga qo'lda</span> yozib beradi
            </h1>

            <p
              className="animate-ink-in mt-6 max-w-xl text-lg leading-relaxed text-pencil/85"
              style={{ animationDelay: "160ms" }}
            >
              Daftar Bot oddiy matnni oladi va uni haqiqiy daftar varaqasidek — yo'l-yo'l yoki katak —
              qo'lyozma bilan yozib, rasm qilib qaytaradi. Adabiyot darslaridagi insholar, diktantlar va
              matematika misollari uchun.
            </p>

            <div
              className="animate-ink-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "240ms" }}
            >
              <Link to="/studio">
                <Button size="lg" variant="marker">
                  Studioda sinab ko'rish
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/bot">
                <Button size="lg" variant="outline">
                  Botni ulash
                </Button>
              </Link>
            </div>

            <dl
              className="animate-ink-in mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-paper-edge pt-6"
              style={{ animationDelay: "320ms" }}
            >
              {[
                { value: "2 xil", label: "daftar turi" },
                { value: "√ ∫ ∑", label: "formulalar" },
                { value: "Ko'p varaq", label: "uzun matn" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="hand text-2xl text-ink">{stat.value}</dt>
                  <dd className="text-xs font-semibold uppercase tracking-wide text-pencil/60">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Varaqalar ko'rinishi */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            {/* Aylantirish (rotate) animatsiya transformini bekor qilmasligi uchun
                har bir varaqa o'z o'ramida animatsiya qilinadi. */}
            <div className="animate-ink-in" style={{ animationDelay: "120ms" }}>
              <PaperMock
                variant="grid"
                title="Mavzu: Kvadrat tenglama"
                lines={["x^2 + 5x - 6 = 0", "D = 25 + 24 = 49", "x1 = 1, x2 = -6", "Javob: 1 va -6"]}
                ink="#1F1F26"
                className="ml-auto w-[78%] rotate-3"
              />
            </div>
            <div
              className="absolute -bottom-10 left-0 w-[72%] animate-ink-in"
              style={{ animationDelay: "240ms" }}
            >
              <PaperMock
                variant="lined"
                title="Sana: 12.10.2026   Mavzu: Ona tili"
                lines={["Kuz keldi. Bog'lar", "sarg'aydi, daraxtlar", "bargini to'kdi."]}
                className="-rotate-3"
                ink="#1B3E8F"
              />
            </div>
            <div className="h-24" />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Nima qiladi                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <header className="mb-10 max-w-2xl">
          <Badge>Imkoniyatlar</Badge>
          <h2 className="hand mt-4 text-4xl text-ink sm:text-5xl">Oddiy so'rov, jonli natija</h2>
          <p className="mt-3 text-base leading-relaxed text-pencil/80">
            Botni yozish texnikasini bilish shart emas: matnni yuborasiz, qolganini Daftar Bot bajaradi.
          </p>
        </header>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card key={feature.title} className="transition-transform duration-300 hover:-translate-y-1">
              <CardHeader>
                <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-marker-soft text-ink">
                  <feature.icon className="h-5 w-5" />
                </span>
                <CardTitle className="hand text-2xl">{feature.title}</CardTitle>
                <CardDescription>{feature.text}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Qanday ishlaydi                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <div className="paper-lined overflow-hidden rounded-2xl border border-paper-edge shadow-paper">
          <div className="relative">
            <div className="absolute inset-y-0 left-[68px] hidden w-[1.5px] bg-margin-soft sm:block" />
            <div className="px-6 py-10 sm:pl-24">
              <Badge tone="sage">Qanday ishlaydi</Badge>
              <h2 className="hand mt-4 text-4xl text-ink sm:text-5xl">To'rt qadamda tayyor</h2>

              <ol className="mt-8 grid gap-6 sm:grid-cols-2">
                {steps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="hand flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink/20 bg-white/80 text-xl text-ink">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold text-ink">{step.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-pencil/80">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <code className="rounded-lg border border-ink/15 bg-white/80 px-3 py-2 text-sm font-semibold text-ink">
                  Telegramda @BotFather → /newbot
                </code>
                <Link to="/bot">
                  <Button variant="outline" size="sm">
                    Batafsil qo'llanma
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Fanlar                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <header className="mb-10 max-w-2xl">
          <Badge tone="margin">Fanlar</Badge>
          <h2 className="hand mt-4 text-4xl text-ink sm:text-5xl">Adabiyot ham, matematika ham</h2>
          <p className="mt-3 text-base leading-relaxed text-pencil/80">
            Har bir fan uchun o'z daftari: matn uchun chiziqli varaq, hisob-kitob uchun katak varaq.
          </p>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="paper-lined border-paper-edge">
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink/8 text-ink">
                <BookOpenText className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="hand text-2xl">Adabiyot va ona tili</CardTitle>
                <CardDescription>
                  She'r, insho, diktant va bayon matnlari chiziqli daftarga satrlab yoziladi. Uzun matn
                  bir necha varaqqa bo'linadi.
                </CardDescription>
              </div>
            </CardHeader>
            <ul className="mt-2 space-y-2 text-sm text-pencil/85">
              {["She'r bandlari satr-satr", "Insho va bayonlar", "Diktant matnlari", "Sana va mavzu sarlavhasi"].map(
                (item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-margin" />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </Card>

          <Card className="paper-grid border-paper-edge">
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sage-soft text-sage">
                <Sigma className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="hand text-2xl">Matematika va algebra</CardTitle>
                <CardDescription>
                  Kasr, daraja, indeks va ildizlar to'g'ri balandlikda joylashadi. Har bir amal katak
                  ichida, xuddi daftardagi kabi.
                </CardDescription>
              </div>
            </CardHeader>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {syntax.map((item) => (
                <div
                  key={item.code}
                  className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2 text-center"
                >
                  <code className="block text-sm font-semibold text-ink">{item.code}</code>
                  <span className="text-[11px] uppercase tracking-wide text-pencil/60">{item.note}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Namunalar                                                        */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <Badge tone="marker">Namunalar</Badge>
            <h2 className="hand mt-4 text-4xl text-ink sm:text-5xl">Daftardan olingan varaqalar</h2>
          </div>
          <Link to="/studio">
            <Button variant="ghost">
              O'z matningiz bilan sinab ko'ring
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </header>

        <div className="grid gap-8 md:grid-cols-3">
          {samples.map((sample) => (
            <figure key={sample.caption} className="group">
              <PaperMock
                variant={sample.variant}
                title={sample.title}
                lines={sample.lines}
                ink={sample.ink}
                className="transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-0 md:rotate-1"
              />
              <figcaption className="mt-3 text-sm font-medium text-pencil/75">{sample.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* FAQ                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-4xl px-5 py-16">
        <header className="mb-8 text-center">
          <Badge tone="sage">Savol-javob</Badge>
          <h2 className="hand mt-4 text-4xl text-ink sm:text-5xl">Ko'p so'raladigan savollar</h2>
        </header>

        <div className="space-y-3">
          {faqs.map((faq) => (
            <details
              key={faq.question}
              className="group rounded-2xl border border-paper-edge bg-white/75 px-5 py-4 shadow-paper open:bg-white"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink">
                {faq.question}
                <span className="hand text-2xl text-marker transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-pencil/85">{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Yakuniy CTA                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-8">
        <div className="relative overflow-hidden rounded-2xl bg-ink px-8 py-12 text-paper shadow-note sm:px-12">
          <div className="pointer-events-none absolute inset-0 opacity-20 paper-grid" />
          <div className="relative flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
            <div className="max-w-xl">
              <h2 className="hand text-4xl leading-tight text-paper sm:text-5xl">
                Birinchi daftar varaqangizni bugun yozamiz
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-paper/80">
                Studio brauzerda darhol ishlaydi, bot esa Telegramda — ikkisi bir xil dvigateldan
                foydalanadi.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link to="/studio">
                <Button size="lg" variant="marker">
                  Studioda sinab ko'rish
                </Button>
              </Link>
              <Link to="/bot">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-paper/40 bg-transparent text-paper hover:bg-paper/10"
                >
                  Botni ulash
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
