import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Eraser,
  PenLine,
  Ruler,
  RotateCcw,
  Shuffle,
  Sigma,
  Sparkles,
  Wand2,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { MiniAppStudio } from "@/components/mini-app-studio";
import { FontGallery } from "@/components/font-gallery";
import { NotebookPreview } from "@/components/notebook-preview";
import { Button } from "@/components/ui/button";
import { Badge, Segmented, Slider } from "@/components/ui/controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/form";
import { useMiniApp } from "@/hooks/use-mini-app";
import { useNotebookRender } from "@/hooks/use-notebook-render";
import { FONT_LIBRARY, fontEntry } from "@/lib/handwriting/fonts.generated";
import {
  GEOMETRY_PRESETS,
  INK_OPTIONS,
  PAGE_FORMAT_OPTIONS,
  PAPER_OPTIONS,
  STYLE_RANGES,
  SUBJECT_PRESETS,
  shuffleHandwriting,
} from "@/lib/handwriting/options";
import { MATH_HELP, MATH_SNIPPETS, SAMPLE_LITERATURE, SAMPLE_MATH } from "@/lib/handwriting/samples";
import {
  changeCase,
  collapseBlankLines,
  removeEmptyLines,
  statsSummary,
  textStats,
  trimLines,
  type CaseMode,
} from "@/lib/handwriting/text-tools";
import { DEFAULT_STYLE, type NotebookStyle } from "@/lib/handwriting/types";

/**
 * Studio — brauzerdagi ishchi panel.
 *
 * Maket ataylab **butun ekran kengligiga** yoyiladi: chapda asboblar (matn,
 * sozlamalar, shriftlar), o'ngda natija varag'i. Tor ekranda (telefon) bu ikki
 * qism ustma-ust tushadi va natija birinchi ko'rinadi.
 *
 * Gorizontal siljish bo'lmasligi uchun har bir ustun `min-w-0` bilan
 * cheklangan: uzun matn yoki keng tugmalar sahifani yon tomonga cho'zmaydi.
 *
 * Telegram ichida bu sahifa ishlatilmaydi — u yerda `MiniAppStudio` ochiladi.
 */
export default function Studio() {
  const [text, setText] = useState(SAMPLE_LITERATURE);
  const [style, setStyle] = useState<NotebookStyle>(DEFAULT_STYLE);
  const [showMathHelp, setShowMathHelp] = useState(false);
  const [showFonts, setShowFonts] = useState(false);
  /** Mini App'da tanlangan boshlanish qatori (1 dan); tanlanmasa — `null`. */
  const [startLine, setStartLine] = useState<number | null>(null);

  const { pages, loading, error, warnings, elapsedMs } = useNotebookRender(text, style);
  const miniApp = useMiniApp();
  /** Botdagi ochiq daftar — Mini App'da matn shunga yoziladi. */
  const activeNotebookId = miniApp.state.state?.activeId ?? null;
  const sideIndex = miniApp.state.state?.side?.sideIndex ?? null;
  const sideNextLine = miniApp.state.state?.side?.nextLine ?? null;

  const stats = textStats(text);

  // Boshqa daftar, boshqa bet yoki betga yangi yozuv qo'shilsa (Studio'ning o'zi
  // yoki chatdan), tanlangan qator eskirib qoladi — uni tozalaymiz.
  useEffect(() => {
    setStartLine(null);
  }, [activeNotebookId, sideIndex, sideNextLine]);

  const updateStyle = useCallback((patch: Partial<NotebookStyle>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetStyle = useCallback(() => setStyle(DEFAULT_STYLE), []);

  /**
   * Matnni almashtiradi (yozish, asbob, namuna yoki tozalash).
   *
   * Oldingi yuborish natijasi xabari yangi matnga tegishli emas — shuning uchun
   * matn o'zgarganda u o'chiriladi.
   */
  const replaceText = useCallback(
    (next: string) => {
      setText(next);
      if (miniApp.send.status !== "idle") miniApp.reset();
    },
    [miniApp],
  );

  /** Tanlangan qatorni bosish/qayta bosish. */
  const pickLine = useCallback((line: number) => {
    setStartLine((prev) => (prev === line ? null : line));
  }, []);

  /** Shrift tanlandi (galereya `memo` bo'lgani uchun funksiya barqaror). */
  const pickFont = useCallback(
    (font: string) => updateStyle({ font }),
    [updateStyle],
  );

  /** «Adabiyot» yoki «Matematika» uchun tayyor kombinatsiyani qo'llaydi. */
  const applyPreset = useCallback((presetId: "adabiyot" | "matematika") => {
    const preset = SUBJECT_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setStyle((prev) => ({ ...prev, paper: preset.style.paper, font: preset.style.font }));
  }, []);

  /**
   * «Boshqacha yozsin»: yangi urug' bilan boshqa yozuv uslubi tanlanadi.
   * Faqat urug' (seed) o'zgarsa varaqa deyarli bir xil qoladi, shuning uchun
   * shrift ham almashtiriladi — yozuv ko'rinadigan darajada boshqacha chiqadi.
   */
  const writeDifferently = useCallback(() => {
    const seed = Date.now() % 999_999;
    setStyle((prev) => ({ ...prev, ...shuffleHandwriting(prev, seed) }));
  }, []);

  /** Matn asboblari: oraliq bo'shliqlar, bo'sh qatorlar va registr. */
  const runTextTool = useCallback(
    (tool: "trim" | "collapse" | "stripEmpty" | CaseMode) => {
      if (tool === "trim") replaceText(trimLines(text));
      else if (tool === "collapse") replaceText(collapseBlankLines(text));
      else if (tool === "stripEmpty") replaceText(removeEmptyLines(text));
      else replaceText(changeCase(text, tool));
    },
    [replaceText, text],
  );

  /**
   * Telegram Mini App ichida butunlay boshqa ko'rinish ishlatiladi.
   *
   * Telegram oynasi tor va baland: brauzerdagi keng maket (ikki ustun, uzun
   * sozlamalar ro'yxati) bu yerda noqulay bo'lardi. Mini App studiyasida
   * natija doim ko'rinib turadi, sozlamalar to'rt bo'limga bo'lingan va yuborish
   * tugmasi pastda yopishib turadi.
   */
  if (miniApp.active) {
    return (
      <MiniAppStudio
        text={text}
        onText={replaceText}
        style={style}
        onStyle={updateStyle}
        onResetStyle={resetStyle}
        onWriteDifferently={writeDifferently}
        onPreset={applyPreset}
        startLine={startLine}
        onPickLine={pickLine}
        render={{ pages, loading, error, warnings, elapsedMs }}
        miniApp={miniApp}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader showBotSetup={false} />

      <main className="mx-auto flex w-full flex-1 flex-col-reverse gap-4 px-3 py-4 sm:px-5 lg:flex-row lg:items-start lg:gap-5">
        {/* Chap ustun: asboblar. Tor ekranda natijadan keyin turadi. */}
        <section className="w-full min-w-0 space-y-4 lg:w-[24rem] lg:shrink-0 xl:w-[26rem]">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Matn</CardTitle>
                <Badge>{statsSummary(stats)}</Badge>
              </div>
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
                rows={10}
                value={text}
                onChange={(event) => replaceText(event.target.value)}
                placeholder="Daftarga ko'chirilishi kerak bo'lgan matnni shu yerga yozing yoki joylashtiring…"
              />

              <div className="flex flex-wrap items-center gap-2 text-xs text-pencil/70">
                <span className="font-semibold text-ink">{stats.filled} qator</span>
                <span>· {stats.empty} bo'sh</span>
                <span>· {stats.words} so'z</span>
                <span>· eng uzuni {stats.longest} belgi</span>
              </div>

              <div className="space-y-2 rounded-xl border border-paper-edge bg-white/60 p-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pencil/60">
                  <Wand2 className="h-3.5 w-3.5 text-marker" />
                  Matn asboblari
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => runTextTool("trim")}>
                    Bo'shliqni tozalash
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runTextTool("collapse")}>
                    Bo'sh qatorlarni birlashtirish
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runTextTool("stripEmpty")}>
                    Bo'sh qatorlarni olib tashlash
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runTextTool("upper")}>
                    KATTA harf
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runTextTool("lower")}>
                    kichik harf
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runTextTool("title")}>
                    Bosh harflar
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => replaceText(SAMPLE_LITERATURE)}>
                  <BookOpen className="h-4 w-4" />
                  Adabiyot namunasi
                </Button>
                <Button variant="outline" size="sm" onClick={() => replaceText(SAMPLE_MATH)}>
                  <Sigma className="h-4 w-4" />
                  Matematika namunasi
                </Button>
                <Button variant="ghost" size="sm" onClick={() => replaceText("")}>
                  <Eraser className="h-4 w-4" />
                  Tozalash
                </Button>
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
                  onChange={(value) => updateStyle({ paper: value })}
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
                        aria-label={option.label}
                        onClick={() => updateStyle({ ink: option.id })}
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
                  onChange={(value) => updateStyle({ pageFormat: value })}
                  options={PAGE_FORMAT_OPTIONS}
                />
              </div>

              <div className="space-y-3 rounded-xl border border-paper-edge bg-white/60 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pencil/60">
                  <Ruler className="h-3.5 w-3.5 text-marker" />
                  Tayyor o'lchamlar
                </p>
                <div className="flex flex-wrap gap-2">
                  {GEOMETRY_PRESETS.map((preset) => {
                    const active =
                      preset.style.fontSize === style.fontSize &&
                      preset.style.lineGap === style.lineGap &&
                      preset.style.marginLeft === style.marginLeft;
                    return (
                      <Button
                        key={preset.id}
                        variant={active ? "marker" : "outline"}
                        size="sm"
                        title={preset.hint}
                        onClick={() => updateStyle(preset.style)}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="mb-0">Harf o'lchami</Label>
                    <span className="text-xs font-semibold text-ink">{style.fontSize} px</span>
                  </div>
                  <Slider
                    className="mt-2"
                    min={STYLE_RANGES.fontSize.min}
                    max={STYLE_RANGES.fontSize.max}
                    value={style.fontSize}
                    onChange={(value) => updateStyle({ fontSize: value })}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="mb-0">Qatorlar orasi</Label>
                    <span className="text-xs font-semibold text-ink">{style.lineGap} px</span>
                  </div>
                  <Slider
                    className="mt-2"
                    min={STYLE_RANGES.lineGap.min}
                    max={STYLE_RANGES.lineGap.max}
                    value={style.lineGap}
                    onChange={(value) => updateStyle({ lineGap: value })}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="mb-0">Chap chegara</Label>
                    <span className="text-xs font-semibold text-ink">{style.marginLeft} px</span>
                  </div>
                  <Slider
                    className="mt-2"
                    min={STYLE_RANGES.marginLeft.min}
                    max={STYLE_RANGES.marginLeft.max}
                    value={style.marginLeft}
                    onChange={(value) => updateStyle({ marginLeft: value })}
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
                    min={STYLE_RANGES.wobble.min}
                    max={STYLE_RANGES.wobble.max}
                    step={0.05}
                    value={style.wobble}
                    onChange={(value) => updateStyle({ wobble: value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-ink/30 accent-marker"
                    checked={style.marginLine}
                    onChange={(event) => updateStyle({ marginLine: event.target.checked })}
                  />
                  Qizil chegara chizig'i
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-ink/30 accent-marker"
                    checked={style.mathMode}
                    onChange={(event) => updateStyle({ mathMode: event.target.checked })}
                  />
                  Matematika yozuvi
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="sage" size="sm" onClick={writeDifferently}>
                  <Shuffle className="h-4 w-4" />
                  Boshqacha yozsin
                </Button>
                <Button variant="ghost" size="sm" onClick={resetStyle}>
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
              <div className="border-t border-paper-edge px-4 py-5 sm:px-6">
                <FontGallery value={style.font} onChange={pickFont} onPreset={applyPreset} />
              </div>
            )}
          </Card>

          <Card className="p-0">
            <button
              type="button"
              onClick={() => setShowMathHelp((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                <Sigma className="h-4 w-4 shrink-0 text-marker" />
                Matematika yozuvi qanday yoziladi?
              </span>
              <ChevronDown
                className={
                  "h-4 w-4 shrink-0 text-ink/50 transition-transform " +
                  (showMathHelp ? "rotate-180" : "")
                }
              />
            </button>
            {showMathHelp && (
              <div className="space-y-3 border-t border-paper-edge px-4 py-4 sm:px-6">
                <div className="flex flex-wrap gap-1.5">
                  {MATH_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet}
                      type="button"
                      title="Matnga qo'shish"
                      onClick={() => replaceText(`${text}${snippet}`)}
                      className="rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 font-mono text-xs text-ink transition-colors hover:border-ink/40"
                    >
                      {snippet}
                    </button>
                  ))}
                </div>
                {MATH_HELP.map((item) => (
                  <div key={item.syntax} className="flex flex-wrap items-baseline gap-2">
                    <code className="rounded-lg bg-ink/8 px-2 py-1 font-mono text-xs text-ink">
                      {item.syntax}
                    </code>
                    <span className="min-w-0 text-sm text-pencil/75">{item.text}</span>
                  </div>
                ))}
                <p className="text-xs text-pencil/60">
                  Karta ichida belgilar ham chiziladi: √ ∫ ∑ ± × ÷ ≤ ≥ ≠ ∞ π ° ∠ ⊥ ∥ → ⇒.
                </p>
              </div>
            )}
          </Card>
        </section>

        {/* O'ng ustun: natija. Ekranning qolgan kengligini to'liq egallaydi. */}
        <section className="w-full min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <Badge tone="marker" className="mb-2">
                <Sparkles className="h-3.5 w-3.5" />
                Studio — brauzerda ishlaydi, serverga yuborilmaydi
              </Badge>
              <h1 className="hand text-3xl leading-tight text-ink sm:text-4xl">
                Matnni yozing — daftarga qo'lda ko'chirilgan rasm chiqadi
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset("adabiyot")}>
                Adabiyot uchun
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("matematika")}>
                Matematika uchun
              </Button>
              <Button variant="sage" size="sm" onClick={writeDifferently}>
                <Shuffle className="h-4 w-4" />
                Boshqacha yozsin
              </Button>
            </div>
          </div>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>Natija</CardTitle>
                  <CardDescription>
                    150 dpi — varaqani shu yerda ko'ring, kattalashtiring yoki yuklab oling.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {elapsedMs !== null && <Badge tone="sage">{elapsedMs} ms</Badge>}
                  <Badge className="max-w-[12rem] truncate">
                    {fontEntry(style.font)?.label ?? style.font}
                  </Badge>
                  <Badge>{pages.length} varaq</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-w-0">
              <NotebookPreview
                pages={pages}
                loading={loading}
                error={error}
                warnings={warnings}
                emptyHint="Matn yozing — daftar varaqasi shu yerda paydo bo'ladi."
              />
            </CardContent>
          </Card>

          {/* Mini App'ni ulashga oid hech qanday bo'lim bu sahifada ataylab yo'q:
              qo'llanma /bot sahifasida. */}
        </section>
      </main>

      <SiteFooter showBotSetup={false} />
    </div>
  );
}
