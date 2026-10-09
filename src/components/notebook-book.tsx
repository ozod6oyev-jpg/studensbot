import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RotateCcw, Scissors, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNotebookRender } from "@/hooks/use-notebook-render";
import { pageSizeFor } from "@/lib/handwriting/options";
import { DEFAULT_STYLE } from "@/lib/handwriting/types";
import {
  fetchNotebookState,
  type MiniAppNotebookPayload,
  type MiniAppNotebookResult,
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
 * Mini App'dagi **kitob ko'rinishi**: daftar ochilgan holda ikki bet — chap va
 * o'ng — muqova o'rtasidan birlashtirilib ko'rsatiladi.
 *
 * Nima uchun ikki bet: yozilgan matn varaq-tomonga ketma-ket tushadi, shuning
 * uchun daftarni ochib qarash uning haqiqiy ko'rinishiga eng yaqin o'qish usuli.
 *
 * Strelkalar ataylab xira (`bg-paper/70`, `text-ink/40`): ular bet chetida
 * turadi va to'liq tiniq bo'lsa betdagi yozuvning chekkasini to'sib qo'yardi.
 */
export function NotebookBook({ notebookId, title, onManage, busy, refreshKey }: NotebookBookProps) {
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [spread, setSpread] = useState<MiniAppSpread | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Daftar almashsa — kitob boshidan ochiladi.
  useEffect(() => {
    setSpreadIndex(0);
    setArmed(null);
    setOutcome(null);
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
      if (result.ok) setReloadTick((prev) => prev + 1);
    },
    [notebookId, onManage],
  );

  const hint = useMemo(() => {
    if (!notebookId) return "Kitobni ko'rish uchun yuqoridan daftar tanlang.";
    if (status === "error") return message ?? "Kitobni ochib bo'lmadi.";
    return null;
  }, [notebookId, status, message]);

  return (
    <Card className="bg-white/70">
      <CardHeader>
        <CardTitle className="hand text-2xl">Kitob ko&apos;rinishi</CardTitle>
        <CardDescription>
          Daftar ochiq holda: chap va o&apos;ng bet bir joydan birlashtirilgan. Yon
          tomonlardagi xira strelkalar bilan varaqlaysiz.
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

            <div className="relative mx-auto w-full max-w-[460px] rounded-2xl border border-paper-edge bg-paper-deep/60 p-1.5 shadow-paper">
              <div className="relative grid grid-cols-2 overflow-hidden rounded-xl">
                <BookHalf
                  side={spread?.left ?? null}
                  pageNumber={spreadIndex * 2 + 1}
                  armed={armed}
                  busy={busy}
                  onArm={setArmed}
                  onClear={clearSide}
                />
                <BookHalf
                  side={spread?.right ?? null}
                  pageNumber={spreadIndex * 2 + 2}
                  armed={armed}
                  busy={busy}
                  onArm={setArmed}
                  onClear={clearSide}
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
}

/**
 * Kitobning bir tomoni: bet rasmi (yoki bo'sh varaqa) va uning oyog'i
 * (bet raqami + yozuvni o'chirish). `useNotebookRender` — hook, shu sababli
 * har bet alohida komponentda chiziladi (hooklar tsikl ichida chaqirilmaydi).
 */
function BookHalf({ side, pageNumber, armed, busy, onArm, onClear }: BookHalfProps) {
  const style = { ...DEFAULT_STYLE, ...(side?.style ?? {}) };
  const size = pageSizeFor(style.pageFormat);
  const rendered = useNotebookRender(side?.text ?? "", style);
  const page = rendered.pages[0];
  const hasText = (side?.text ?? "").trim().length > 0;

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
