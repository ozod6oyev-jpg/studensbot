import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RotateCcw, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotebookRender } from "@/hooks/use-notebook-render";
import { loadFontBytes } from "@/lib/handwriting/browser";
import { parseFont } from "@/lib/handwriting/font";
import { FALLBACK_FONT_ID, fontEntry } from "@/lib/handwriting/fonts.generated";
import { measureSideText, type SideTextMeasure } from "@/lib/handwriting/notebook-text";
import { pageSizeFor } from "@/lib/handwriting/options";
import { DEFAULT_STYLE, type NotebookStyle } from "@/lib/handwriting/types";
import {
  fetchNotebookState,
  type MiniAppNotebookPayload,
  type MiniAppNotebookResult,
  type MiniAppPoint,
  type MiniAppSpread,
  type MiniAppSpreadSide,
} from "@/lib/telegram/mini-app";
import { cn } from "@/lib/utils";

export interface NotebookBookProps {
  /** Tanlangan daftar id'si (bo'lmasa — kitob ko'rsatilmaydi). */
  notebookId: string | null;
  /** Daftar nomi (sarlavha uchun). */
  title: string | null;
  /** Betni tozalash kabi amallar (botga yuboriladi). */
  onManage: (payload: MiniAppNotebookPayload) => Promise<MiniAppNotebookResult>;
  /** Daftar amali bajarilmoqda — tugmalar shu vaqtda bloklanadi. */
  busy: boolean;
  /** Bu qiymat o'zgarganda kitob qayta o'qiladi (yozuvdan keyin). */
  refreshKey?: string | number;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * Oraliq o'chirish oqimining qadami: boshlanish qatori/so'zi, keyin tugash
 * qatori/so'zi. `null` — oqim boshlamagan.
 */
type PickStep = "startLine" | "startWord" | "endLine" | "endWord" | null;

/** Tanlanayotgan qator (so'zi hali tanlanmagan). */
interface PendingLine {
  side: number;
  line: number;
}

/** `a` nuqta `b` dan keyinmi (o'zi ham hisobga olinadi). */
function afterPoint(a: MiniAppPoint, b: MiniAppPoint): boolean {
  if (a.side !== b.side) return a.side > b.side;
  if (a.line !== b.line) return a.line > b.line;
  return a.word >= b.word;
}

/** Nuqtani o'qiladigan ko'rinishga keltiradi: «2-bet 3-qator 1-so'z». */
function pointText(point: MiniAppPoint): string {
  return `${point.side + 1}-bet ${point.line}-qator ${point.word}-so'z`;
}

/**
 * O'lchov holati: qator/so'z tugmalari faqat `ready` bo'lganda ko'rsatiladi.
 *
 * Bu holatsiz panel yuklanayotganda "bu betda yozuv yo'q" deb aytib qo'yardi
 * (o'lchov hali kelmagan bo'lsa ham), xato bo'lganda esa jimgina bo'sh
 * qolardi.
 */
type MeasureStatus = "idle" | "loading" | "ready" | "error";

interface SideMeasureState {
  measure: SideTextMeasure | null;
  status: MeasureStatus;
}

/**
 * Betdagi qator va so'z tuzilishini o'lchaydi (bot bilan bir xil yo'l:
 * o'sha shrift, o'sha uslub). Rasm chizishdan oldin shrift fayli yuklanadi.
 */
function useSideMeasure(text: string, style: NotebookStyle): SideMeasureState {
  const [state, setState] = useState<SideMeasureState>({ measure: null, status: "idle" });
  const key = `${style.font ?? FALLBACK_FONT_ID}\u0000${style.pageFormat}\u0000${style.lineGap}\u0000${text}`;

  useEffect(() => {
    let cancelled = false;
    if (text.trim().length === 0) {
      setState({ measure: null, status: "idle" });
      return () => {
        cancelled = true;
      };
    }

    setState({ measure: null, status: "loading" });

    void (async () => {
      try {
        const id = style.font ?? FALLBACK_FONT_ID;
        // Botning `measureSide` i bilan bir xil shartlar: zaxira (kirillcha)
        // shrift va shriftning o'z masshtabi ham hisobga olinadi. Ularsiz
        // kirillcha matnda qatorlar boshqa joydan uzilib, qator/so'z raqamlari
        // surilib ketardi — natijada noto'g'ri so'zlar o'chirilardi.
        const [bytes, fallbackBytes] = await Promise.all([
          loadFontBytes(id),
          id === FALLBACK_FONT_ID
            ? Promise.resolve(null)
            : loadFontBytes(FALLBACK_FONT_ID).catch(() => null),
        ]);
        if (cancelled) return;
        const primary = parseFont(id, bytes);
        const secondary = fallbackBytes ? parseFont(FALLBACK_FONT_ID, fallbackBytes) : undefined;
        if (cancelled) return;
        setState({
          measure: measureSideText({
            text,
            style,
            primary,
            secondary,
            sizeScale: fontEntry(id)?.sizeScale ?? 1,
          }),
          status: "ready",
        });
      } catch {
        if (!cancelled) setState({ measure: null, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `key` o'lchovga ta'sir qiladigan hamma narsani (shrift, uslub, matn)
    // o'z ichiga oladi.
  }, [key]);

  return state;
}

/**
 * Mini App'dagi **kitob ko'rinishi**: daftar ochilgan holda ikki bet — chap va
 * o'ng — muqova o'rtasidan birlashtirilib ko'rsatiladi.
 *
 * Nima uchun ikki bet: yozilgan matn varaq-tomonga ketma-ket tushadi, shuning
 * uchun daftarni ochib qarash uning haqiqiy ko'rinishiga eng yaqin o'qish usuli.
 *
 * Strelkalar ataylab xira (`bg-paper/70`, `text-ink/40`): ular bet chetida
 * turadi va to'liq tiniq bo'lsa betdagi yozuvning chekkasini to'sib qo'yardi.
 *
 * Betdagi yozuvni ikki yo'l bilan o'chirish mumkin: butun betni («Tozalash»)
 * yoki tanlangan oraliqni (qatordan-so'zga) — ikkinchisi botdagi ✂️ Yozuvni
 * o'chirish oqimi bilan bir xil, faqat shu yerda bajariladi.
 */
export function NotebookBook({ notebookId, title, onManage, busy, refreshKey }: NotebookBookProps) {
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [spread, setSpread] = useState<MiniAppSpread | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Oraliq o'chirish: qadam, tanlangan nuqtalar va qator ichidagi so'z tanlovi.
  const [step, setStep] = useState<PickStep>(null);
  const [pending, setPending] = useState<PendingLine | null>(null);
  const [from, setFrom] = useState<MiniAppPoint | null>(null);
  const [to, setTo] = useState<MiniAppPoint | null>(null);
  const [pickHint, setPickHint] = useState<string | null>(null);

  // Daftar almashsa — kitob boshidan ochiladi.
  useEffect(() => {
    setSpreadIndex(0);
    setArmed(null);
    setOutcome(null);
    setStep(null);
    setPending(null);
    setFrom(null);
    setTo(null);
    setPickHint(null);
  }, [notebookId]);

  // Kitob ochilgan ko'rinishini botdan o'qiymiz (har bet o'z uslubi bilan).
  useEffect(() => {
    if (!notebookId) {
      setSpread(null);
      setStatus("idle");
      setMessage(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    void (async () => {
      const result = await fetchNotebookState(notebookId, spreadIndex);
      if (cancelled) return;
      if (!result.ok) {
        setStatus("error");
        setMessage(result.message ?? "Kitobni ochib bo'lmadi.");
        return;
      }
      const next = result.state?.spread ?? null;
      setSpread(next);
      setStatus("ready");
      setMessage(null);
      // Bet tozalangandan keyin ko'rinishlar soni kamayishi mumkin — bot
      // qaytargan haqiqiy indeksga moslashamiz (aks holda strelka "tiqilib"
      // qolardi).
      if (next && next.index !== spreadIndex) setSpreadIndex(next.index);
    })();

    return () => {
      cancelled = true;
    };
  }, [notebookId, spreadIndex, refreshKey, reloadTick]);

  const total = spread?.total ?? 1;
  const canBack = spreadIndex > 0;
  const canForward = spreadIndex < total - 1;

  const flip = useCallback(
    (delta: number) => {
      setArmed(null);
      setSpreadIndex((prev) => Math.max(0, Math.min(total - 1, prev + delta)));
    },
    [total],
  );

  // Klaviatura: strelkalar bilan varaqlash (Telegram oynasida ham qulay).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Matn maydonida yozayotganda strelkalar kursorni yuritadi — kitob
      // varaqlanishi shu paytda aralashmasligi kerak.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (event.key === "ArrowLeft") flip(-1);
      else if (event.key === "ArrowRight") flip(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip]);

  const clearSide = useCallback(
    async (side: MiniAppSpreadSide) => {
      if (!notebookId) return;
      const result = await onManage({ action: "clearSide", notebookId, sideIndex: side.index });
      setArmed(null);
      setOutcome({ ok: result.ok, message: result.message });
      if (result.ok) {
        // Bet bo'shadi: undagi eski oraliq tanlovi endi ma'nosiz, shuning uchun
        // tanlovni ham tozalaymiz (aks holda "Ha, o'chirish" eski nuqtalarni
        // yuborib, "so'z topilmadi" degan xabar chiqardi).
        setStep(null);
        setPending(null);
        setFrom(null);
        setTo(null);
        setPickHint(null);
        setReloadTick((prev) => prev + 1);
      }
    },
    [notebookId, onManage],
  );

  const startRange = useCallback(() => {
    setArmed(null);
    setOutcome(null);
    setPickHint(null);
    setPending(null);
    setFrom(null);
    setTo(null);
    setStep("startLine");
  }, []);

  const cancelRange = useCallback(() => {
    setStep(null);
    setPending(null);
    setFrom(null);
    setTo(null);
    setPickHint(null);
  }, []);

  /** Qator tanlandi: boshlanish bo'lsa — so'z tanlashga, tugash bo'lsa — oraliqni tekshirib. */
  const pickLine = useCallback(
    (sideIndex: number, line: number) => {
      if (step === "startLine") {
        setPending({ side: sideIndex, line });
        setStep("startWord");
        setPickHint(null);
        return;
      }
      if (step === "endLine") {
        // Bir xil qatorning o'zi ham tugash bo'lishi mumkin (masalan oraliq shu
        // qatorning ichida tugasa) — qaysi so'z ekani keyingi qadamda
        // tanlanadi, shuning uchun bu yerda faqat oldinroq bet/qator rad
        // etiladi.
        const before =
          from !== null &&
          (sideIndex < from.side || (sideIndex === from.side && line < from.line));
        if (before) {
          setPickHint("Tugash joyi boshlanishidan oldin bo'lmaydi — boshqa qatorni tanlang.");
          return;
        }
        setPending({ side: sideIndex, line });
        setStep("endWord");
        setPickHint(null);
      }
    },
    [step, from],
  );

  /** So'z tanlandi: ikkala nuqta ham to'lsa — tasdiqlash ko'rsatiladi. */
  const pickWord = useCallback(
    (sideIndex: number, line: number, word: number) => {
      const point: MiniAppPoint = { side: sideIndex, line, word };
      if (step === "startWord") {
        setFrom(point);
        setPending(null);
        setStep("endLine");
        setPickHint(null);
        return;
      }
      if (step === "endWord") {
        if (from && !afterPoint(point, from)) {
          setPickHint("Tugash so'zi boshlanishidan oldin bo'lmaydi — boshqa so'zni tanlang.");
          return;
        }
        setTo(point);
        setPending(null);
        setStep(null);
      }
    },
    [step, from],
  );

  const submitRange = useCallback(async () => {
    if (!notebookId || !from || !to) return;
    const result = await onManage({ action: "deleteRange", notebookId, from, to });
    setOutcome({ ok: result.ok, message: result.message });
    if (result.ok) {
      setFrom(null);
      setTo(null);
      setPickHint(null);
      setReloadTick((prev) => prev + 1);
    }
  }, [notebookId, from, to, onManage]);

  const stepHint = useMemo(() => {
    if (step === "startLine") return "Boshlanish: betdagi qator raqamini bosing.";
    if (step === "startWord")
      return pending
        ? `Boshlanish: ${pending.side + 1}-betning ${pending.line}-qatoridagi so'zni bosing.`
        : "Boshlanish qatoridagi so'zni bosing.";
    if (step === "endLine") return "Tugash: betdagi qator raqamini bosing.";
    if (step === "endWord")
      return pending
        ? `Tugash: ${pending.side + 1}-betning ${pending.line}-qatoridagi so'zni bosing.`
        : "Tugash qatoridagi so'zni bosing.";
    return null;
  }, [step, pending]);

  const hint = useMemo(() => {
    if (!notebookId) return "Kitobni ko'rish uchun yuqoridan daftar tanlang.";
    if (status === "error") return message ?? "Kitobni ochib bo'lmadi.";
    return null;
  }, [notebookId, status, message]);

  const rangeActive = step !== null || from !== null || to !== null;

  return (
    <Card className="bg-white/70">
      <CardHeader>
        <CardTitle className="hand text-2xl">Kitob ko&apos;rinishi</CardTitle>
        <CardDescription>
          Daftar ochiq holda: chap va o&apos;ng bet bir joydan birlashtirilgan. Yon
          tomonlardagi xira strelkalar bilan varaqlaysiz; yozuvning bir qismini
          &laquo;Oraliqni o&apos;chirish&raquo; bilan tanlab o&apos;chirasiz.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {hint ? (
          <div className="space-y-2 rounded-xl border border-paper-edge bg-white/60 p-3 text-xs leading-relaxed text-pencil/80">
            <p className="flex items-start gap-2">
              {status === "error" && (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-margin" />
              )}
              <span>{hint}</span>
            </p>
            {status === "error" && (
              <Button variant="outline" size="sm" onClick={() => setReloadTick((prev) => prev + 1)}>
                <RotateCcw className="h-4 w-4" />
                Qayta urinish
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-ink">
                {title ?? "Daftar"} · {spreadIndex * 2 + 1}–{spreadIndex * 2 + 2}
              </span>
              <span className="text-[11px] text-pencil/70">
                {spread ? `${spread.usedSides}/${spread.capacity} bet` : "…"} ·{" "}
                {spreadIndex + 1}/{total} ko&apos;rinish
              </span>
            </div>

            {/* Oraliqni o'chirish boshqaruvi. */}
            <div className="space-y-2 rounded-xl border border-paper-edge bg-white/60 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {!rangeActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !spread}
                    onClick={startRange}
                  >
                    <Scissors className="h-4 w-4" />
                    Oraliqni o&apos;chirish
                  </Button>
                )}
                {stepHint && <span className="text-xs text-pencil/75">{stepHint}</span>}
                {rangeActive && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={cancelRange}>
                    <X className="h-4 w-4" />
                    Bekor qilish
                  </Button>
                )}
              </div>

              {from && (
                <p className="text-[11px] leading-relaxed text-pencil/75">
                  <span className="font-semibold text-ink">Boshlanish:</span> {pointText(from)}
                  {to && (
                    <>
                      {" · "}
                      <span className="font-semibold text-ink">Tugash:</span> {pointText(to)}
                    </>
                  )}
                </p>
              )}

              {from && to && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="default" size="sm" disabled={busy} onClick={() => void submitRange()}>
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Scissors className="h-3.5 w-3.5" />
                    )}
                    Ha, o&apos;chirish
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={cancelRange}>
                    <X className="h-3.5 w-3.5" />
                    Yo&apos;q
                  </Button>
                </div>
              )}

              {pickHint && <p className="text-[11px] leading-relaxed text-margin">{pickHint}</p>}
              {!rangeActive && (
                <p className="text-[11px] leading-relaxed text-pencil/65">
                  Tugmani bosib, boshlanish (qator → so&apos;z) va tugash joyini tanlaysiz; so&apos;zlar
                  tayyor tugmalar bo&apos;lib chiqadi.
                </p>
              )}
            </div>

            <div className="relative mx-auto w-full max-w-[460px] rounded-2xl border border-paper-edge bg-paper-deep/60 p-1.5 shadow-paper">
              <div className="relative grid grid-cols-2 overflow-hidden rounded-xl">
                <BookHalf
                  side={spread?.left ?? null}
                  pageNumber={spreadIndex * 2 + 1}
                  armed={armed}
                  busy={busy}
                  onArm={setArmed}
                  onClear={clearSide}
                  step={step}
                  pending={pending}
                  from={from}
                  to={to}
                  onPickLine={pickLine}
                  onPickWord={pickWord}
                />
                <BookHalf
                  side={spread?.right ?? null}
                  pageNumber={spreadIndex * 2 + 2}
                  armed={armed}
                  busy={busy}
                  onArm={setArmed}
                  onClear={clearSide}
                  step={step}
                  pending={pending}
                  from={from}
                  to={to}
                  onPickLine={pickLine}
                  onPickWord={pickWord}
                />
                {/* Muqova o'rtasi: ikki betni birlashtirib turadigan soya. */}
                <span className="pointer-events-none absolute inset-y-0 left-1/2 w-4 -translate-x-1/2 bg-gradient-to-r from-ink/10 via-ink/25 to-ink/10" />
              </div>

              {/* Varaqlash strelkalari — xira, shuning uchun yozuvni to'smaydi. */}
              <button
                type="button"
                title="Oldingi ko'rinish"
                aria-label="Oldingi ko'rinish"
                disabled={!canBack || status === "loading"}
                onClick={() => flip(-1)}
                className="absolute left-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-paper/70 text-ink/40 shadow-sm backdrop-blur-sm transition-colors hover:text-ink/75 disabled:pointer-events-none disabled:opacity-60"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                title="Keyingi ko'rinish"
                aria-label="Keyingi ko'rinish"
                disabled={!canForward || status === "loading"}
                onClick={() => flip(1)}
                className="absolute right-2 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-paper/70 text-ink/40 shadow-sm backdrop-blur-sm transition-colors hover:text-ink/75 disabled:pointer-events-none disabled:opacity-60"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              {status === "loading" && (
                <span className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-white/85 px-2 py-0.5 text-[10px] text-pencil/70">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  ochilmoqda
                </span>
              )}
            </div>

            <p className="text-center text-[11px] leading-relaxed text-pencil/65">
              Strelkalar yoki klaviaturadagi ← → tugmalari bilan varaqlaysiz.
            </p>

            {outcome && (
              <p
                className={cn(
                  "flex gap-2 rounded-xl border p-2.5 text-xs leading-relaxed",
                  outcome.ok
                    ? "border-sage/40 bg-sage-soft/40 text-ink"
                    : "border-margin/40 bg-margin-soft/40 text-margin",
                )}
              >
                <span>{outcome.message}</span>
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface BookHalfProps {
  side: MiniAppSpreadSide | null;
  pageNumber: number;
  armed: number | null;
  busy: boolean;
  onArm: (sideIndex: number | null) => void;
  onClear: (side: MiniAppSpreadSide) => Promise<void>;
  /** Oraliq tanlash qadami (boshlamagan bo'lsa — `null`). */
  step: PickStep;
  /** So'zi tanlanayotgan qator (qaysi betda ekani bilan). */
  pending: PendingLine | null;
  from: MiniAppPoint | null;
  to: MiniAppPoint | null;
  onPickLine: (sideIndex: number, line: number) => void;
  onPickWord: (sideIndex: number, line: number, word: number) => void;
}

/**
 * Kitobning bir tomoni: bet rasmi (yoki bo'sh varaqa), oyog'i (bet raqami +
 * yozuvni o'chirish) va — oraliq tanlanayotganda — qator/so'z tugmalari.
 *
 * `useNotebookRender` va `useSideMeasure` — hooklar, shu sababli har bet
 * alohida komponentda chiziladi (hooklar tsikl ichida chaqirilmaydi).
 */
function BookHalf({
  side,
  pageNumber,
  armed,
  busy,
  onArm,
  onClear,
  step,
  pending,
  from,
  to,
  onPickLine,
  onPickWord,
}: BookHalfProps) {
  const style: NotebookStyle = { ...DEFAULT_STYLE, ...(side?.style ?? {}) };
  const size = pageSizeFor(style.pageFormat);
  const rendered = useNotebookRender(side?.text ?? "", style);
  const page = rendered.pages[0];
  const text = side?.text ?? "";
  const hasText = text.trim().length > 0;
  const { measure, status: measureStatus } = useSideMeasure(text, style);

  // Bet indeksi: `side` bo'lmasa — `-1` (solishtirish hech qachon mos kelmaydi).
  const sideIndex = side?.index ?? -1;
  const pickingLine = step === "startLine" || step === "endLine";
  const pickingWord =
    pending !== null && pending.side === sideIndex && (step === "startWord" || step === "endWord");
  const linesWithWords = (measure?.lines ?? []).filter((line) => line.words.length > 0);
  const pendingWords = pending && measure ? (measure.lines[pending.line - 1]?.words ?? []) : [];
  const marksThisSide = from?.side === sideIndex || to?.side === sideIndex;

  return (
    <div className="flex flex-col bg-paper">
      <div className="relative min-h-[150px] w-full">
        {page ? (
          <img src={page.url} alt={`${pageNumber}-bet`} className="block w-full" />
        ) : (
          <div
            className={cn(
              "w-full",
              style.paper === "lined" && "paper-lined",
              style.paper === "grid" && "paper-grid",
            )}
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
          />
        )}
      </div>

      {(pickingLine || pickingWord) && side !== null && (
        <div className="border-t border-paper-edge/70 bg-white/70 px-2 py-1.5">
          {pickingLine && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pencil/60">
                Qatorni tanlang
              </p>
              {measureStatus === "loading" && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-pencil/65">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Qatorlar o&apos;lchanmoqda…
                </p>
              )}
              {measureStatus === "error" && (
                <p className="mt-1 text-[11px] leading-relaxed text-margin">
                  Qatorlarni o&apos;lchab bo&apos;lmadi — betni qaytadan ochib ko&apos;ring.
                </p>
              )}
              {(measureStatus === "ready" || measureStatus === "idle") &&
                linesWithWords.length === 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-pencil/65">
                    Bu betda yozuv yo&apos;q — boshqa betdan tanlang.
                  </p>
                )}
              {measureStatus === "ready" && linesWithWords.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {linesWithWords.map((line) => {
                    const isFrom = from?.side === sideIndex && from.line === line.index;
                    const isTo = to?.side === sideIndex && to.line === line.index;
                    return (
                      <button
                        key={line.index}
                        type="button"
                        disabled={busy}
                        title={`${line.index}-qator`}
                        onClick={() => onPickLine(sideIndex, line.index)}
                        className={cn(
                          "min-w-[1.75rem] rounded-lg border px-1.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40",
                          isFrom && "border-marker bg-marker/25 text-ink ring-1 ring-marker/60",
                          isTo && "border-margin bg-margin-soft/50 text-margin",
                          !isFrom && !isTo && "border-ink/15 bg-white text-ink/70 hover:border-ink/35",
                        )}
                      >
                        {line.index}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {pickingWord && pending && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-pencil/60">
                {pending.line}-qatordagi so&apos;zni tanlang
              </p>
              {measureStatus === "error" && (
                <p className="mt-1 text-[11px] leading-relaxed text-margin">
                  So&apos;zlarni o&apos;lchab bo&apos;lmadi — betni qaytadan ochib ko&apos;ring.
                </p>
              )}
              {measureStatus === "loading" && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-pencil/65">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  So&apos;zlar o&apos;lchanmoqda…
                </p>
              )}
              {(measureStatus === "idle" ||
                (measureStatus === "ready" && pendingWords.length === 0)) && (
                <p className="mt-1 text-[11px] leading-relaxed text-pencil/65">
                  Bu qatorda so&apos;z yo&apos;q — boshqa qatorni tanlang.
                </p>
              )}
              {measureStatus === "ready" && pendingWords.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {pendingWords.map((word, index) => {
                    const wordNumber = index + 1;
                    const isFrom =
                      from?.side === sideIndex &&
                      from.line === pending.line &&
                      from.word === wordNumber;
                    const isTo =
                      to?.side === sideIndex && to.line === pending.line && to.word === wordNumber;
                    return (
                      <button
                        key={`${pending.line}-${wordNumber}`}
                        type="button"
                        disabled={busy}
                        title={word}
                        onClick={() => onPickWord(sideIndex, pending.line, wordNumber)}
                        className={cn(
                          "max-w-[7rem] truncate rounded-lg border px-1.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40",
                          isFrom && "border-marker bg-marker/25 text-ink ring-1 ring-marker/60",
                          isTo && "border-margin bg-margin-soft/50 text-margin",
                          !isFrom && !isTo && "border-ink/15 bg-white text-ink/70 hover:border-ink/35",
                        )}
                      >
                        {wordNumber} {word}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {side !== null && marksThisSide && (
        <p className="border-t border-paper-edge/70 bg-white/50 px-2 py-1 text-[10px] leading-relaxed text-pencil/70">
          {from?.side === sideIndex && <span className="text-ink">◆ {pointText(from)}</span>}
          {from?.side === sideIndex && to?.side === sideIndex && " · "}
          {to?.side === sideIndex && <span className="text-margin">◇ {pointText(to)}</span>}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-paper-edge/70 px-2 py-1.5">
        <span className="text-[11px] font-semibold text-pencil/70">{pageNumber}-bet</span>

        {side && hasText && armed !== side.index && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onArm(side.index)}>
            <Scissors className="h-3.5 w-3.5" />
            Tozalash
          </Button>
        )}

        {side && hasText && armed === side.index && (
          <span className="flex flex-wrap items-center gap-1">
            <Button variant="default" size="sm" disabled={busy} onClick={() => void onClear(side)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
              Ha, o&apos;chirish
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onArm(null)}>
              <X className="h-3.5 w-3.5" />
              Yo&apos;q
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

export default NotebookBook;
