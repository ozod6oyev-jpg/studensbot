import { useEffect, useState } from "react";
import { AlertTriangle, Download, FileDown, Loader2, ScrollText } from "lucide-react";
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

function download(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function NotebookPreview({
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

  const firstUrl = pages[0]?.url ?? "";
  useEffect(() => {
    setActive(0);
  }, [firstUrl]);

  const safeActive = active < pages.length ? active : Math.max(pages.length - 1, 0);
  const current = pages[safeActive];
  const totalKb = current ? Math.max(1, Math.round(current.bytes / 1024)) : 0;

  return (
    <div className="space-y-4">
      {pages.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {pages.map((page, index) => (
            <button
              key={page.url}
              type="button"
              onClick={() => setActive(index)}
              title={`${page.index}-varaq`}
              className={cn(
                "h-20 w-14 overflow-hidden rounded-lg border bg-white shadow-sm transition-all",
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

      <div className="relative overflow-hidden rounded-2xl bg-paper-deep/70 p-3 sm:p-5">
        <div
          className={cn(
            "relative mx-auto w-full max-w-[560px] transition-transform duration-500",
            "hover:-rotate-[0.6deg] hover:scale-[1.01]",
          )}
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
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/45 backdrop-blur-[1px]">
              <span className="flex items-center gap-2 rounded-full bg-ink/85 px-4 py-2 text-sm font-semibold text-paper shadow-note">
                <Loader2 className="h-4 w-4 animate-spin" />
                Yozilmoqda…
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-pencil/75">
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
              Shu varaqni yuklash
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
              Hammasini yuklash ({pages.length})
            </Button>
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-2 rounded-xl border border-marker/40 bg-marker-soft/50 p-3 text-sm text-ink">
          {warnings.map((warning) => (
            <li key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-marker" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="flex gap-2 rounded-xl border border-margin/40 bg-margin-soft/40 p-3 text-sm text-margin">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
