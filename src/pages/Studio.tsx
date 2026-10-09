import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Eraser,
  Loader2,
  PenLine,
  RotateCcw,
  Send,
  Shuffle,
  Sigma,
  Sparkles,
  X,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { MiniAppWriter } from "@/components/mini-app-writer";
import { useMiniApp } from "@/hooks/use-mini-app";
import { cn } from "@/lib/utils";
import { FontGallery } from "@/components/font-gallery";
import { NotebookPreview } from "@/components/notebook-preview";
import { Button } from "@/components/ui/button";
import { Badge, Segmented, Slider } from "@/components/ui/controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/form";
import { useNotebookRender } from "@/hooks/use-notebook-render";
import { FONT_LIBRARY, fontEntry } from "@/lib/handwriting/fonts.generated";
import {
  INK_OPTIONS,
  PAGE_FORMAT_OPTIONS,
  PAPER_OPTIONS,
  SUBJECT_PRESETS,
  shuffleHandwriting,
} from "@/lib/handwriting/options";
import { DEFAULT_STYLE, type NotebookStyle } from "@/lib/handwriting/types";

const SAMPLE_LITERATURE = [
  "Vatan haqida",
  "",
  "Vatan — bu faqat tuproq emas, u — bolaligim, onamning ovozi, tonggi shabada.",
  "Ko'ngil qaysi yurtda bo'lmasin, vatan o'sha yerda boshlanadi.",
  "",
  "A. Oripov",
].join("\n");

const SAMPLE_MATH = [
  "Mavzu: Kvadrat tenglama",
  "",
  "x^2 - 5x + 6 = 0",
  "D = b^2 - 4ac = 25 - 24 = 1",
  "",
  "x_1 = \\frac{5 + 1}{2} = 3",
  "",
  "x_2 = \\frac{5 - 1}{2} = 2",
  "",
  "Javob: x_1 = 3, x_2 = 2",
].join("\n");

const MATH_HELP: { syntax: string; text: string }[] = [
  { syntax: "x^2", text: "yuqori indeks — daraja (kvadrat, kub va boshqalar)" },
  { syntax: "a_1", text: "pastki indeks — element raqami, indeks" },
  { syntax: "\\frac{a}{b}", text: "kasr — surat tepada, maxraj pastda, chiziq bilan" },
  { syntax: "\\sqrt{x}", text: "ildiz belgisi bilan o'ralgan ifoda" },
];

export default function Studio() {
  const [text, setText] = useState(SAMPLE_LITERATURE);
  const [style, setStyle] = useState<NotebookStyle>(DEFAULT_STYLE);
  const [showMathHelp, setShowMathHelp] = useState(false);
  const [showFonts, setShowFonts] = useState(false);
  /** Mini App'da tanlangan boshlanish qatori (1 dan); tanlanmasa — `null`. */
  const [startLine, setStartLine] = useState<number | null>(null);

  const { pages, loading, error, warnings, elapsedMs } = useNotebookRender(text, style);
  const miniApp = useMiniApp();
  const sending = miniApp.send.status === "sending";
  /** Botdagi ochiq daftar — matn shunga yoziladi. */
  const activeNotebookId = miniApp.state.state?.activeId ?? null;
  const sideIndex = miniApp.state.state?.side?.sideIndex ?? null;

  // Boshqa daftar (yoki boshqa bet) tanlansa, oldingi qator tanlovi eskirib qoladi.
  useEffect(() => {
    setStartLine(null);
  }, [activeNotebookId, sideIndex]);

  const update = <K extends keyof NotebookStyle>(key: K, value: NotebookStyle[K]) =>
    setStyle((prev) => ({ ...prev, [key]: value }));

  /** Telegram Mini App rejimida: matn, sozlamalar, daftar va qatorni botga yuboradi. */
  const sendToChat = () => {
    void miniApp.sendToChat({
      text,
      style,
      notebookId: activeNotebookId ?? undefined,
      startLine: startLine ?? undefined,
    });
  };

  /** "Adabiyot" yoki "Matematika" uchun tayyor kombinatsiyani qo'llaydi. */
  const applyPreset = (presetId: "adabiyot" | "matematika") => {
    const preset = SUBJECT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setStyle((prev) => ({ ...prev, paper: preset.style.paper, font: preset.style.font }));
  };

  /**
   * «Boshqacha yozsin»: yangi urug' bilan boshqa yozuv uslubi tanlanadi.
   * Faqat urug' (seed) o'zgarsa varaqa deyarli bir xil qoladi, shuning uchun
   * shrift ham almashtiriladi — yozuv ko'rinadigan darajada boshqacha chiqadi.
   */
  const writeDifferently = () => {
    const seed = Date.now() % 999_999;
    setStyle((prev) => ({ ...prev, ...shuffleHandwriting(prev, seed) }));
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">
        {miniApp.active && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-marker/40 bg-white/80 px-4 py-3 shadow-note">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-paper">
                <Send className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold text-ink">
                  {miniApp.userName ?? "Telegram foydalanuvchisi"}
                </p>
                <p className="text-xs text-pencil/70">
                  Mini App rejimi — natijani chatga yuborish mumkin
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={miniApp.close}>
              <X className="h-4 w-4" />
              Yopish
            </Button>
          </div>
        )}

        <div className="mb-8 max-w-3xl">
          <Badge tone="marker" className="mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            Studio — brauzerda ishlaydi, serverga yuborilmaydi
          </Badge>
          <h1 className="hand text-4xl leading-tight text-ink sm:text-5xl">
            Matnni yozing — daftarga qo'lda ko'chirilgan rasm chiqadi
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-pencil/80">
            Adabiyot uchun yo'l-yo'l daftar, matematika uchun katak daftar. Bot ham xuddi shu
            dvigateldan foydalanadi — shu yerda xohlagan variantingizni topib, keyin Telegramda
            ishlatasiz.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <div className="space-y-6">
            {/* Telegram Mini App: natijani to'g'ridan-to'g'ri chatga qaytarish */}
            <Card
              className={cn(
                miniApp.active && "border-marker/45 bg-marker-soft/25",
                !miniApp.active && "bg-white/70",
              )}
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="hand text-2xl">Chatga yuborish</CardTitle>
                    <CardDescription>
                      {miniApp.active
                        ? "Matn va tanlangan sozlamalar botga yuboriladi — varaqalar shu chatga qaytadi."
                        : "Studio Telegram ichida (Mini App) ochilsa, natijani chatga yuborish mumkin."}
                    </CardDescription>
                  </div>
                  <Badge tone={miniApp.active ? "marker" : "ink"}>
                    {miniApp.active ? "Mini App" : "Brauzer"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {miniApp.active ? (
                  <>
                    <Button
                      variant="marker"
                      className="w-full"
                      onClick={sendToChat}
                      disabled={sending || text.trim().length === 0}
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {sending ? "Yuborilmoqda…" : "Chatga yuborish"}
                    </Button>
                    {miniApp.send.message && (
                      <p
                        className={cn(
                          "flex gap-2 rounded-xl border p-3 text-sm",
                          miniApp.send.status === "sent"
                            ? "border-sage/40 bg-sage-soft/50 text-ink"
                            : "border-margin/40 bg-margin-soft/40 text-margin",
                        )}
                      >
                        {miniApp.send.status === "sent" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>{miniApp.send.message}</span>
                      </p>
                    )}
                    <p className="text-xs leading-relaxed text-pencil/65">
                      Sozlamalar botda ham saqlanadi: keyingi varaqalar shu uslubda chiziladi.
                      {activeNotebookId
                        ? startLine
                          ? ` Matn tanlangan daftarga ${startLine}-qatordan boshlab yoziladi.`
                          : " Matn pastda tanlangan daftarga yoziladi."
                        : " Chatda ochiq daftar bo'lsa, matn o'sha daftarga yoziladi."}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-relaxed text-pencil/85">
                      Telegramda botni ochib, menyudagi{" "}
                      <span className="font-semibold text-ink">🖥 Studio (Mini App)</span> tugmasini
                      bosing (yoki{" "}
                      <code className="rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[13px]">
                        /studio
                      </code>{" "}
                      buyrug'ini yuboring) — Studio to'g'ridan-to'g'ri Telegram oynasida ochiladi,
                      matnni yozasiz va natijani shu chatga yuborasiz.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Mini App: qaysi daftarga va qaysi qatordan yozishni tanlash */}
            {miniApp.active && (
              <MiniAppWriter
                bundle={miniApp.state}
                onReload={(notebookId) => void miniApp.reloadState(notebookId)}
                startLine={startLine}
                onPickLine={setStartLine}
                onManage={miniApp.manageNotebook}
                busy={miniApp.notebookBusy}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle>Matn</CardTitle>
                <CardDescription>
                  Har bir yangi qator daftarda alohida satr bo'ladi. Matematik yozuvlar uchun{" "}
                  <code className="rounded bg-ink/8 px-1.5 py-0.5 text-xs text-ink">^</code>,{" "}
                  <code className="rounded bg-ink/8 px-1.5 py-0.5 text-xs text-ink">_</code>,{" "}
                  <code className="rounded bg-ink/8 px-1.5 py-0.5 text-xs text-ink">\frac</code>,{" "}
                  <code className="rounded bg-ink/8 px-1.5 py-0.5 text-xs text-ink">\sqrt</code>{" "}
                  ishlatiladi.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  rows={12}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Daftarga ko'chirilishi kerak bo'lgan matnni shu yerga yozing yoki joylashtiring…"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-pencil/60">
                    {text.length} belgi · {pages.length || 1} varaq
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setText(SAMPLE_LITERATURE)}>
                      <BookOpen className="h-4 w-4" />
                      Adabiyot namunasi
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setText(SAMPLE_MATH)}>
                      <Sigma className="h-4 w-4" />
                      Matematika namunasi
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setText("")}>
                      <Eraser className="h-4 w-4" />
                      Tozalash
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Daftar sozlamalari</CardTitle>
                <CardDescription>
                  Varaq, siyoh va o'lchamlarni tanlang — yozuv uslubi pastdagi galereyada.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <Label>Daftar turi</Label>
                  <Segmented
                    className="w-full"
                    value={style.paper}
                    onChange={(value) => update("paper", value)}
                    options={PAPER_OPTIONS}
                  />
                </div>

                <div>
                  <Label>Siyoh rangi</Label>
                  <div className="flex flex-wrap gap-2">
                    {INK_OPTIONS.map((option) => {
                      const active = option.id === style.ink;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          title={option.label}
                          onClick={() => update("ink", option.id)}
                          className={
                            "flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-all " +
                            (active
                              ? "border-marker ring-2 ring-marker/40"
                              : "border-ink/15 hover:border-ink/35")
                          }
                        >
                          <span
                            className="h-5 w-5 rounded-full"
                            style={{ backgroundColor: option.hex }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label>Varaq formati</Label>
                  <Segmented
                    className="w-full"
                    value={style.pageFormat}
                    onChange={(value) => update("pageFormat", value)}
                    options={PAGE_FORMAT_OPTIONS}
                  />
                </div>

                <div className="space-y-4 rounded-xl border border-paper-edge bg-white/60 p-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="mb-0">Harf o'lchami</Label>
                      <span className="text-xs font-semibold text-ink">{style.fontSize} px</span>
                    </div>
                    <Slider
                      className="mt-2"
                      min={26}
                      max={52}
                      value={style.fontSize}
                      onChange={(value) => update("fontSize", value)}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="mb-0">Qatorlar orasi</Label>
                      <span className="text-xs font-semibold text-ink">{style.lineGap} px</span>
                    </div>
                    <Slider
                      className="mt-2"
                      min={40}
                      max={80}
                      value={style.lineGap}
                      onChange={(value) => update("lineGap", value)}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="mb-0">Chap chegara</Label>
                      <span className="text-xs font-semibold text-ink">{style.marginLeft} px</span>
                    </div>
                    <Slider
                      className="mt-2"
                      min={60}
                      max={180}
                      value={style.marginLeft}
                      onChange={(value) => update("marginLeft", value)}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="mb-0">Qo'lyozma jonliligi</Label>
                      <span className="text-xs font-semibold text-ink">
                        {Math.round(style.wobble * 100)}%
                      </span>
                    </div>
                    <Slider
                      className="mt-2"
                      min={0}
                      max={1}
                      step={0.05}
                      value={style.wobble}
                      onChange={(value) => update("wobble", value)}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-5">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink/30 accent-marker"
                      checked={style.marginLine}
                      onChange={(event) => update("marginLine", event.target.checked)}
                    />
                    Qizil chegara chizig'i
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-ink/30 accent-marker"
                      checked={style.mathMode}
                      onChange={(event) => update("mathMode", event.target.checked)}
                    />
                    Matematika yozuvi
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="sage" size="sm" onClick={writeDifferently}>
                    <Shuffle className="h-4 w-4" />
                    Boshqacha yozsin
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStyle(DEFAULT_STYLE)}>
                    <RotateCcw className="h-4 w-4" />
                    Standart
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="p-0">
              <button
                type="button"
                onClick={() => setShowFonts((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  <PenLine className="h-4 w-4 shrink-0 text-marker" />
                  <span className="truncate">
                    Yozuv uslubi — {fontEntry(style.font)?.label ?? style.font}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone="marker" className="text-[10px]">
                    {FONT_LIBRARY.length} shrift
                  </Badge>
                  <ChevronDown
                    className={
                      "h-4 w-4 text-ink/50 transition-transform " + (showFonts ? "rotate-180" : "")
                    }
                  />
                </span>
              </button>
              {showFonts && (
                <div className="border-t border-paper-edge px-6 py-5">
                  <FontGallery
                    value={style.font}
                    onChange={(font) => update("font", font)}
                    onPreset={applyPreset}
                  />
                </div>
              )}
            </Card>

            <Card className="p-0">
              <button
                type="button"
                onClick={() => setShowMathHelp((prev) => !prev)}
                className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Sigma className="h-4 w-4 text-marker" />
                  Matematika yozuvi qanday yoziladi?
                </span>
                <ChevronDown
                  className={
                    "h-4 w-4 text-ink/50 transition-transform " + (showMathHelp ? "rotate-180" : "")
                  }
                />
              </button>
              {showMathHelp && (
                <div className="space-y-3 border-t border-paper-edge px-6 py-4">
                  {MATH_HELP.map((item) => (
                    <div key={item.syntax} className="flex flex-wrap items-baseline gap-2">
                      <code className="rounded-lg bg-ink/8 px-2 py-1 font-mono text-xs text-ink">
                        {item.syntax}
                      </code>
                      <span className="text-sm text-pencil/75">{item.text}</span>
                    </div>
                  ))}
                  <p className="text-xs text-pencil/60">
                    Karta ichida belgilar ham chiziladi: √ ∫ ∑ ± × ÷ ≤ ≥ ≠ ∞ π ° ∠ ⊥ ∥ → ⇒.
                  </p>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>Natija</CardTitle>
                    <CardDescription>
                      Tanlangan formatda, 150 dpi — ekranda ko'rish va chop etish uchun.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {elapsedMs !== null && <Badge tone="sage">{elapsedMs} ms</Badge>}
                    <Badge>{fontEntry(style.font)?.label ?? style.font}</Badge>
                    <Badge>{pages.length} varaq</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <NotebookPreview
                  pages={pages}
                  loading={loading}
                  error={error}
                  warnings={warnings}
                  emptyHint="Matn yozing — daftar varaqasi shu yerda paydo bo'ladi."
                />
              </CardContent>
            </Card>

            {/* Mini App ichida «Botni ulash» bo'limi ko'rsatilmaydi: bot allaqachon
                ulangan, ulash qo'llanmasi esa texnik ish — u faqat sayt ko'rinishida
                chiqadi. */}
            {!miniApp.active && (
              <Card className="bg-sage-soft/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="hand text-2xl text-ink">Shu sozlamalar botda ham ishlaydi</p>
                    <p className="mt-1 text-sm text-pencil/75">
                      Telegramga matn yuborsangiz, bot aynan shu ko'rinishdagi rasmni qaytaradi.
                    </p>
                  </div>
                  <Link
                    to="/bot"
                    className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-paper shadow-note transition-transform hover:-translate-y-0.5"
                  >
                    Botni ulash →
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
