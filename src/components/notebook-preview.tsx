import { memo, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PreviewPage {
  index: number;
  total: number;
  width: number;
  height: number;
  url: string;
  bytes: number;
}

/** Kattalashtirish qadamlari (`null` — varaqa ustunning kengligiga sig'diriladi). */
const ZOOM_STEPS = [50, 75, 100, 125, 150, 200];

function download(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Natija varag'i: varaqalar tasmasi, sahifa bo'ylab o'tish, kattalashtirish va
 * yuklab olish.
 *
 * Kattalashtirish **tugmalar bilan** boshqariladi (`−` / `+` / «Sig'dirish»):
 * sahifani barmoq bilan surish yoki brauzerni masshtablash shart emas. Sukut
 * holatda varaqa ustunning kengligiga to'liq sig'adi, kattalashtirilganda esa
 * faqat shu oyna ichida siljiydi — butun sahifa qimirlamaydi.
 */
export const NotebookPreview = memo(function NotebookPreview({
  pages,
  loading,
  error,
  warnings,
  emptyHint,
}: {
  pages: PreviewPage[];
  loading: boolean;
  error: string | null;
  warnings: string[];
  emptyHint: string;
}) {
  const [active, setActive] = useState(0);
  /** `null` — varaqa kenglikka sig'diriladi (sahifa siljimaydi). */
  const [zoom, setZoom] = useState<number | null>(null);

  const firstUrl = pages[0]?.url ?? "";
  useEffect(() => {
    setActive(0);
  }, [firstUrl]);

  const safeActive = active < pages.length ? active : Math.max(pages.length - 1, 0);
  const current = pages[safeActive];
  const totalKb = current ? Math.max(1, Math.round(current.bytes / 1024)) : 0;

  const zoomOut = () => {
    if (zoom === null) return;
    const previous = [...ZOOM_STEPS].reverse().find((step) => step < zoom);
    setZoom(previous ?? null);
  };
  const zoomIn = () => {
    if (zoom === null) {
      setZoom(ZOOM_STEPS.find((step) => step > 100) ?? 125);
      return;
    }
    setZoom(ZOOM_STEPS.find((step) => step > zoom) ?? zoom);
  };

  return (
    <div className="min-w-0 space-y-4">
      {pages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pages.map((page, index) => (
            <button
              key={page.url}
              type="button"
              onClick={() => setActive(index)}
              title={`${page.index}-varaq`}
              className={cn(
                "h-20 w-14 shrink-0 overflow-hidden rounded-lg border bg-white shadow-sm transition-all",
                index === safeActive
                  ? "border-marker ring-2 ring-marker/40"
                  : "border-paper-edge opacity-75 hover:opacity-100",
              )}
            >
              <img src={page.url} alt={`${page.index}-varaq`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="min-w-0 rounded-2xl bg-paper-deep/70 p-3 sm:p-5">
        {current && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Oldingi varaqa"
                aria-label="Oldingi varaqa"
                disabled={safeActive === 0}
                onClick={() => setActive(Math.max(0, safeActive - 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[4.5rem] text-center text-sm font-semibold text-ink">
                {current.index} / {current.total}
              </span>
              <button
                type="button"
                title="Keyingi varaqa"
                aria-label="Keyingi varaqa"
                disabled={safeActive >= pages.length - 1}
                onClick={() => setActive(Math.min(pages.length - 1, safeActive + 1))}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="Kichraytirish"
                aria-label="Kichraytirish"
                disabled={zoom === null}
                onClick={zoomOut}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-[3.5rem] text-center text-xs font-semibold text-ink">
                {zoom === null ? "Sig'dirish" : `${zoom}%`}
              </span>
              <button
                type="button"
                title="Kattalashtirish"
                aria-label="Kattalashtirish"
                disabled={zoom !== null && zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                onClick={zoomIn}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(null)}
                disabled={zoom === null}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-ink/15 bg-white/80 px-2.5 text-xs font-semibold text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Sig'dirish
              </button>
            </div>
          </div>
        )}

        <div className={cn("min-w-0", zoom !== null && "max-h-[70vh] overflow-auto")}>
          <div
            className={cn("min-w-0", zoom === null ? "w-full" : "mx-auto")}
            style={zoom === null ? undefined : { width: `${zoom}%` }}
          >
            {current ? (
              <img
                src={current.url}
                alt={`Daftar varaqasi ${current.index}`}
                className="w-full rounded-xl border border-paper-edge shadow-paper"
              />
            ) : (
              <div className="paper-lined flex min-h-[320px] items-center justify-center rounded-xl border border-paper-edge p-8 text-center">
                <div className="max-w-xs space-y-2">
                  <ScrollText className="mx-auto h-8 w-8 text-ink/30" />
                  <p className="hand text-2xl text-ink/70">{emptyHint}</p>
                </div>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 py-3">
                <span className="flex items-center gap-2 rounded-full bg-ink/85 px-4 py-1.5 text-xs font-semibold text-paper shadow-note">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Qayta yozilmoqda…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-pencil/75">
          {current ? (
            <>
              <span className="font-semibold text-ink">
                {current.index} / {current.total} varaq
              </span>
              <span className="text-pencil/40">•</span>
              <span>
                {current.width}×{current.height} px
              </span>
              <span className="text-pencil/40">•</span>
              <span>{totalKb} KB</span>
            </>
          ) : (
            <span>Hozircha rasm yo'q</span>
          )}
        </div>

        {pages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => current && download(current.url, `daftar-${current.index}.png`)}
            >
              <Download className="h-4 w-4" />
              Shu varaq
            </Button>
            <Button
              variant="marker"
              size="sm"
              onClick={async () => {
                for (const page of pages) {
                  download(page.url, `daftar-${page.index}.png`);
                  await new Promise((resolve) => setTimeout(resolve, 400));
                }
              }}
            >
              <FileDown className="h-4 w-4" />
              Hammasi ({pages.length})
            </Button>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-2 rounded-xl border border-marker/40 bg-marker-soft/50 p-3 text-sm text-ink">
          {warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-marker" />
              <span className="min-w-0">{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="flex gap-2 rounded-xl border border-margin/40 bg-margin-soft/40 p-3 text-sm text-margin">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </div>
  );
});
