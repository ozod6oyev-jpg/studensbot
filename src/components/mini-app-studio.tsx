import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileDown,
  FileText,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  PenLine,
  BookMarked,
  Plus,
  RotateCcw,
  Ruler,
  Send,
  Shuffle,
  Sigma,
  Sparkles,
  Type,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { FontGallery } from "@/components/font-gallery";
import { MiniAppWriter } from "@/components/mini-app-writer";
import { StyleCopy } from "@/components/style-copy";
import { NotebookBook } from "@/components/notebook-book";
import { Button } from "@/components/ui/button";
import { Badge, Segmented, Slider, Switch } from "@/components/ui/controls";
import { Label, Textarea } from "@/components/ui/form";
import type { useMiniApp } from "@/hooks/use-mini-app";
import type { RenderedPageMeta } from "@/hooks/use-notebook-render";
import { fontEntry } from "@/lib/handwriting/fonts.generated";
import {
  GEOMETRY_PRESETS,
  INK_OPTIONS,
  PAGE_FORMAT_OPTIONS,
  PAPER_OPTIONS,
  STYLE_RANGES,
} from "@/lib/handwriting/options";
import {
  MATH_HELP,
  MATH_SNIPPETS,
  SAMPLE_LITERATURE,
  SAMPLE_MATH,
} from "@/lib/handwriting/samples";
import {
  changeCase,
  collapseBlankLines,
  removeEmptyLines,
  textStats,
  trimLines,
  type CaseMode,
} from "@/lib/handwriting/text-tools";
import type { NotebookStyle } from "@/lib/handwriting/types";
import { MINI_APP_TEXT_LIMIT, type MiniAppNotebookPayload } from "@/lib/telegram/mini-app";
import { cn } from "@/lib/utils";

/**
 * Telegram Mini App ichidagi Studio — telefon uchun qurilgan ishchi panel.
 *
 * Brauzerdagi Studio katta ekranga mo'ljallangan (uch ustun, uzun ro'yxatlar);
 * Telegram oynasi esa tor va baland. Shu sababli Mini App uchun alohida
 * ko'rinish: tepada qisqa holat satri (daftar, band betlar), o'rtada natija
 * sahnasi, pastda esa ilovadek yopishib turadigan bo'limlar va yuborish tugmasi.
 *
 * Uzun sozlamalar ro'yxati yig'ilib qolmasligi uchun hammasi to'rt bo'limga
 * (Matn / Uslub / Varaq / Daftar) bo'lingan: ekranda faqat kerakli qism turadi,
 * natija va yuborish tugmasi esa doim ko'rinib turadi.
 */

type PanelId = "text" | "style" | "paper" | "notebook";

const PANELS: { id: PanelId; label: string; icon: typeof Type }[] = [
  { id: "text", label: "Matn", icon: Type },
  { id: "style", label: "Uslub", icon: PenLine },
  { id: "paper", label: "Varaq", icon: FileText },
  { id: "notebook", label: "Daftar", icon: BookMarked },
];

export interface StudioRenderState {
  pages: RenderedPageMeta[];
  loading: boolean;
  error: string | null;
  warnings: string[];
  elapsedMs: number | null;
}

export interface MiniAppStudioProps {
  /** Daftarga yoziladigan matn. */
  text: string;
  /** Matn o'zgardi (yangi matn bilan almashtiriladi). */
  onText: (next: string) => void;
  /** Joriy sozlamalar (qog'oz, siyoh, shrift, o'lchamlar). */
  style: NotebookStyle;
  /** Sozlamalarning bir qismini o'zgartirish. */
  onStyle: (patch: Partial<NotebookStyle>) => void;
  /** Sozlamalarni standart holatga qaytarish. */
  onResetStyle: () => void;
  /** «Boshqacha yozsin»: yangi urug' va shrift bilan qayta chizish. */
  onWriteDifferently: () => void;
  /** Fan bo'yicha tayyor kombinatsiya (adabiyot / matematika). */
  onPreset: (presetId: "adabiyot" | "matematika") => void;
  /** Tanlangan boshlanish qatori (1 dan); `null` — oxiridan davom etadi. */
  startLine: number | null;
  /** Varaqadagi qatorni tanlash (qayta bosilsa — bekor qilish). */
  onPickLine: (line: number) => void;
  /** Brauzerda chizilgan natija (matn va sozlamalardan hisoblanadi). */
  render: StudioRenderState;
  /** Bot bilan aloqa: daftarlar, yuborish, daftar amallari, yopish. */
  miniApp: ReturnType<typeof useMiniApp>;
}

/** Butun ekran ko'rinishidagi masshtab qadamlari (`null` — ekranga sig'dirish). */
const OVERLAY_ZOOM = [50, 75, 100, 150, 200];

/** Kichik sozlama qatori: nomi, joriy qiymati va suriladigan chizig'i. */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="mb-0">{label}</Label>
        <span className="text-xs font-semibold text-ink">
          {step < 1 ? `${Math.round(value * 100)}%` : `${value} ${suffix}`}
        </span>
      </div>
      <Slider className="mt-2" min={min} max={max} step={step} value={value} onChange={onChange} />
    </div>
  );
}

/** Sozlamalar guruhini bir xil ko'rinishda o'rash uchun (ixtiyoriy belgi bilan). */
function Group({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof Type;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-paper-edge bg-white/70 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-pencil/60">
        {Icon && <Icon className="h-3.5 w-3.5 text-marker" />}
        {title}
      </p>
      {children}
    </div>
  );
}

export const MiniAppStudio = memo(function MiniAppStudio({
  text,
  onText,
  style,
  onStyle,
  onResetStyle,
  onWriteDifferently,
  onPreset,
  startLine,
  onPickLine,
  render,
  miniApp,
}: MiniAppStudioProps) {
  const [panel, setPanel] = useState<PanelId>("text");
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  /** Butun ekran ko'rinishidagi masshtab; `null` — varaqa ekranga sig'diriladi. */
  const [overlayScale, setOverlayScale] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [activePage, setActivePage] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const state = miniApp.state.state;
  const activeNotebook = state?.notebooks.find((item) => item.id === state.activeId) ?? null;
  const side = state?.side ?? null;
  const sending = miniApp.send.status === "sending";
  const trimmedLength = text.trim().length;
  const overLimit = trimmedLength > MINI_APP_TEXT_LIMIT;
  const pages = render.pages;
  const stats = textStats(text);

  /** Shrift tanlandi — galereya `memo` bo'lgani uchun funksiya barqaror bo'lishi kerak. */
  const pickFont = useCallback((font: string) => onStyle({ font }), [onStyle]);

  /** Matn asboblari: oraliq bo'shliqlar, bo'sh qatorlar va registr. */
  const runTextTool = useCallback(
    (tool: "trim" | "collapse" | "stripEmpty" | CaseMode) => {
      if (tool === "trim") onText(trimLines(text));
      else if (tool === "collapse") onText(collapseBlankLines(text));
      else if (tool === "stripEmpty") onText(removeEmptyLines(text));
      else onText(changeCase(text, tool));
    },
    [onText, text],
  );

  // Yangi natija chizilgach birinchi varaq ko'rsatiladi (har yangilanishda
  // oldingi varaq raqami yangi natijaga to'g'ri kelmasligi mumkin).
  const firstUrl = pages[0]?.url ?? "";
  useEffect(() => {
    setActivePage(0);
  }, [firstUrl]);

  const safePage = activePage < pages.length ? activePage : Math.max(pages.length - 1, 0);
  const current = pages[safePage];
  const fontLabel = fontEntry(style.font)?.label ?? style.font;
  const progress =
    activeNotebook && activeNotebook.capacity > 0
      ? Math.min(100, Math.round((activeNotebook.usedSides / activeNotebook.capacity) * 100))
      : 0;

  // Kattalashtirilgan varaqa orqasidagi sahifa surilmasin.
  useEffect(() => {
    if (!zoom) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [zoom]);

  useEffect(() => {
    if (!menuOpen && !zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setZoom(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, zoom]);

  /** Matn maydoniga kursordan (yoki oxiridan) matematik bo'lak qo'shadi. */
  const insertSnippet = (snippet: string) => {
    const field = textareaRef.current;
    if (!field) {
      onText(`${text}${snippet}`);
      return;
    }
    const start = field.selectionStart ?? text.length;
    const end = field.selectionEnd ?? start;
    onText(`${text.slice(0, start)}${snippet}${text.slice(end)}`);
    const caret = start + snippet.length;
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };

  /** Menyudagi tez amal (orqaga qaytarish, PDF kitob) natijasini ko'rsatadi. */
  const runQuickAction = async (payload: MiniAppNotebookPayload) => {
    setMenuOpen(false);
    const result = await miniApp.manageNotebook(payload);
    setNotice({ ok: result.ok, message: result.message });
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-paper">
      {/* Yuqori satr: qaysi daftar, qancha bet band — va tez amallar. */}
      <header className="sticky top-0 z-30 border-b border-paper-edge/80 bg-paper/92 backdrop-blur-md">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper shadow-note">
            <PenLine className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-ink">
                {activeNotebook?.title ?? "Daftar tanlanmagan"}
              </p>
              {miniApp.state.status === "loading" && (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-pencil/60" />
              )}
              {activeNotebook && (
                <span className="shrink-0 rounded-full bg-ink/8 px-2 py-0.5 text-[11px] font-semibold text-ink/70">
                  {activeNotebook.usedSides}/{activeNotebook.capacity} bet
                </span>
              )}
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-marker transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            title="Tez amallar"
            aria-label="Tez amallar"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink/15 bg-white/70 text-ink/70 transition-colors hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Yopish"
            aria-label="Yopish"
            onClick={miniApp.close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-ink/15 bg-white/70 text-ink/70 transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Menyuni yopish"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-30 cursor-default bg-ink/20"
            />
            <div className="absolute right-3 top-full z-40 mt-1 w-[15rem] overflow-hidden rounded-2xl border border-paper-edge bg-paper shadow-note">
              <p className="border-b border-paper-edge/70 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-pencil/60">
                {miniApp.userName ?? "Telegram"} · Studio
              </p>
              <button
                type="button"
                disabled={miniApp.notebookBusy || !activeNotebook}
                onClick={() => void runQuickAction({ action: "undo", notebookId: activeNotebook?.id })}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4 text-marker" />
                Oxirgi yozuvni qaytarish
              </button>
              <button
                type="button"
                disabled={miniApp.notebookBusy || !activeNotebook}
                onClick={() => void runQuickAction({ action: "book", notebookId: activeNotebook?.id })}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink disabled:opacity-40"
              >
                <FileDown className="h-4 w-4 text-marker" />
                PDF kitob qilib yuborish
              </button>
              <button
                type="button"
                onClick={() => {
                  onWriteDifferently();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink"
              >
                <Shuffle className="h-4 w-4 text-marker" />
                Boshqacha yozsin
              </button>
              <button
                type="button"
                onClick={() => {
                  onResetStyle();
                  setMenuOpen(false);
                  setNotice({ ok: true, message: "Sozlamalar standart holatga qaytarildi." });
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-medium text-ink"
              >
                <RotateCcw className="h-4 w-4 text-marker" />
                Standart sozlamalar
              </button>
            </div>
          </>
        )}

        {notice && (
          <div
            className={cn(
              "flex items-start gap-2 border-t px-3 py-2 text-xs leading-relaxed",
              notice.ok
                ? "border-sage/30 bg-sage-soft/40 text-ink"
                : "border-margin/30 bg-margin-soft/40 text-margin",
            )}
          >
            {notice.ok ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span className="flex-1">{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Xabarni yopish">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

      {/* Natija sahnasi: chizilgan varaqa, varaqalar ro'yxati va kattalashtirish. */}
      <section className="px-3 pt-3">
        <div className="rounded-2xl border border-paper-edge bg-paper-deep/60 p-2.5 shadow-paper">
          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Badge tone="sage" className="px-2.5 py-0.5 text-[11px]">
                {pages.length || 1} varaq
              </Badge>
              <Badge className="max-w-[9rem] truncate px-2.5 py-0.5 text-[11px]">{fontLabel}</Badge>
              {render.elapsedMs !== null && (
                <Badge className="px-2.5 py-0.5 text-[11px]">{render.elapsedMs} ms</Badge>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {pages.length > 1 && (
                <>
                  <button
                    type="button"
                    title="Oldingi varaqa"
                    aria-label="Oldingi varaqa"
                    disabled={safePage === 0}
                    onClick={() => setActivePage(Math.max(0, safePage - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-[11px] font-semibold text-ink/70">
                    {safePage + 1}/{pages.length}
                  </span>
                  <button
                    type="button"
                    title="Keyingi varaqa"
                    aria-label="Keyingi varaqa"
                    disabled={safePage >= pages.length - 1}
                    onClick={() => setActivePage(Math.min(pages.length - 1, safePage + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 bg-white/80 text-ink/70 disabled:opacity-40"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {current && (
                <button
                  type="button"
                  onClick={() => {
                    setZoom(true);
                    setOverlayScale(null);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-ink/75 transition-colors hover:bg-ink/5 hover:text-ink"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Kattalashtirish
                </button>
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-paper-edge bg-white">
            {current ? (
              <img
                src={current.url}
                alt={`${current.index}-varaq`}
                className="w-full"
                onClick={() => {
                  // Kattalashtirish har safar ekranga sig'dirishdan boshlanadi:
                  // aks holda oldingi masshtab (masalan 200%) saqlanib qolardi.
                  setOverlayScale(null);
                  setZoom(true);
                }}
              />
            ) : (
              <div className="paper-lined flex min-h-[16rem] flex-col items-center justify-center gap-2 p-6 text-center">
                {render.loading ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-ink/40" />
                    <p className="text-sm text-pencil/70">Varaqa chizilmoqda…</p>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-6 w-6 text-ink/30" />
                    <p className="hand text-2xl text-ink/70">Matn yozing</p>
                    <p className="max-w-[16rem] text-xs leading-relaxed text-pencil/65">
                      «Matn» bo'limiga yozganingiz shu yerda daftar varaqasi bo'lib chiqadi.
                    </p>
                  </>
                )}
              </div>
            )}

            {render.loading && current && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                <span className="flex items-center gap-2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs font-semibold text-paper shadow-note">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Qayta yozilmoqda…
                </span>
              </div>
            )}
          </div>

          {pages.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
              {pages.map((page, index) => (
                <button
                  key={page.url}
                  type="button"
                  onClick={() => setActivePage(index)}
                  title={`${page.index}-varaq`}
                  className={cn(
                    "h-14 w-10 shrink-0 overflow-hidden rounded-lg border bg-white transition-all",
                    index === safePage
                      ? "border-marker ring-2 ring-marker/40"
                      : "border-paper-edge opacity-70 hover:opacity-100",
                  )}
                >
                  <img src={page.url} alt={`${page.index}-varaqa`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {render.warnings.length > 0 && (
            <ul className="mt-2 space-y-1.5 rounded-xl border border-marker/40 bg-marker-soft/50 p-2.5 text-xs text-ink">
              {render.warnings.map((warning, index) => (
                // Bir xil matnli ogohlantirish ikki marta kelishi mumkin — kalit
                // faqat matndan olinsa React bir xil kalit haqida ogohlantiradi.
                <li key={`${index}-${warning}`} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-marker" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}

          {render.error && (
            <p className="mt-2 flex gap-2 rounded-xl border border-margin/40 bg-margin-soft/40 p-2.5 text-xs text-margin">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{render.error}</span>
            </p>
          )}
        </div>
      </section>

      {/* Tanlangan bo'lim: matn, uslub, varaq yoki daftar amallari. */}
      <main className="flex-1 space-y-3 px-3 py-3">
        {panel === "text" && (
          <div className="space-y-3">
            <Group title="Daftar matni">
              <div className="flex items-center justify-between">
                <Label className="mb-0">Har bir qator — alohida satr</Label>
                <span
                  className={cn(
                    "text-xs font-semibold",
                    overLimit ? "text-margin" : "text-pencil/60",
                  )}
                >
                  {trimmedLength} / {MINI_APP_TEXT_LIMIT}
                </span>
              </div>
              <Textarea
                ref={textareaRef}
                rows={9}
                className="text-base"
                value={text}
                onChange={(event) => onText(event.target.value)}
                placeholder="Daftarga ko'chirilishi kerak bo'lgan matnni yozing yoki joylashtiring…"
              />
              {overLimit && (
                <p className="rounded-xl border border-margin/40 bg-margin-soft/40 p-2.5 text-xs leading-relaxed text-margin">
                  Matn chegaradan uzun — bot uni rad etadi. Matnni bo'lib yuboring.
                </p>
              )}
            </Group>

            <Group title="Matn asboblari" icon={Wand2}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pencil/70">
                <span className="font-semibold text-ink">{stats.filled} qator</span>
                <span>· {stats.empty} bo'sh</span>
                <span>· {stats.words} so'z</span>
                <span>· eng uzuni {stats.longest} belgi</span>
              </div>
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
              <p className="text-xs leading-relaxed text-pencil/65">
                Asboblar matnni almashtiradi — keyin «Chatga yuborish» bilan yuboriladi.
              </p>
            </Group>

            <Group title="Matematik belgilar" icon={Sigma}>
              <p className="text-xs leading-relaxed text-pencil/70">
                Tugma bosilganda belgi kursordan qo'shiladi:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MATH_SNIPPETS.map((snippet) => (
                  <button
                    key={snippet}
                    type="button"
                    onClick={() => insertSnippet(snippet)}
                    className="rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 font-mono text-xs text-ink transition-colors hover:border-ink/40"
                  >
                    {snippet}
                  </button>
                ))}
              </div>
              <details className="text-xs text-pencil/75">
                <summary className="cursor-pointer font-semibold text-ink/80">
                  Belgilar nimani anglatadi?
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {MATH_HELP.map((item) => (
                    <li key={item.syntax} className="flex flex-wrap items-baseline gap-1.5">
                      <code className="rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {item.syntax}
                      </code>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Group>

            <Group title="Namunalar">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onText(SAMPLE_LITERATURE)}
                >
                  <BookOpen className="h-4 w-4" />
                  Adabiyot
                </Button>
                <Button variant="outline" size="sm" onClick={() => onText(SAMPLE_MATH)}>
                  <Sigma className="h-4 w-4" />
                  Matematika
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onText("")}>
                  <Eraser className="h-4 w-4" />
                  Tozalash
                </Button>
              </div>
            </Group>
          </div>
        )}

        {panel === "style" && (
          <div className="space-y-3">
            <Group title="Yozuv uslubi">
              <FontGallery value={style.font} onChange={pickFont} onPreset={onPreset} />
            </Group>

            {/* O'z qo'lyozmangizni nusxalash: namuna Studio'da o'lchanadi, */}
            {/* uslubni bot saqlaydi (shrift fayllari u yerda). */}
            <StyleCopy
              styles={miniApp.state.state?.styles ?? []}
              styleId={miniApp.state.state?.styleId ?? null}
              busy={miniApp.notebookBusy}
              onReload={() => void miniApp.reloadState()}
            />

            <Group title="Siyoh rangi">
              <div className="flex flex-wrap gap-2">
                {INK_OPTIONS.map((option) => {
                  const active = option.id === style.ink;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      title={option.label}
                      aria-label={option.label}
                      onClick={() => onStyle({ ink: option.id })}
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-all",
                        active ? "border-marker ring-2 ring-marker/40" : "border-ink/15",
                      )}
                    >
                      <span
                        className="h-5 w-5 rounded-full"
                        style={{ backgroundColor: option.hex }}
                      />
                    </button>
                  );
                })}
              </div>
            </Group>

            <Group title="O'lchamlar" icon={Ruler}>
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
                      onClick={() => onStyle(preset.style)}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
              <SliderRow
                label="Harf o'lchami"
                value={style.fontSize}
                min={STYLE_RANGES.fontSize.min}
                max={STYLE_RANGES.fontSize.max}
                suffix="px"
                onChange={(value) => onStyle({ fontSize: value })}
              />
              <SliderRow
                label="Qatorlar orasi"
                value={style.lineGap}
                min={STYLE_RANGES.lineGap.min}
                max={STYLE_RANGES.lineGap.max}
                suffix="px"
                onChange={(value) => onStyle({ lineGap: value })}
              />
              <SliderRow
                label="Chap chegara"
                value={style.marginLeft}
                min={STYLE_RANGES.marginLeft.min}
                max={STYLE_RANGES.marginLeft.max}
                suffix="px"
                onChange={(value) => onStyle({ marginLeft: value })}
              />
              <SliderRow
                label="Qo'lyozma jonliligi"
                value={style.wobble}
                min={STYLE_RANGES.wobble.min}
                max={STYLE_RANGES.wobble.max}
                step={0.05}
                suffix="%"
                onChange={(value) => onStyle({ wobble: value })}
              />
            </Group>

            <div className="flex flex-wrap gap-2">
              <Button variant="sage" size="sm" onClick={onWriteDifferently}>
                <Shuffle className="h-4 w-4" />
                Boshqacha yozsin
              </Button>
              <Button variant="ghost" size="sm" onClick={onResetStyle}>
                <RotateCcw className="h-4 w-4" />
                Standart
              </Button>
            </div>
          </div>
        )}

        {panel === "paper" && (
          <div className="space-y-3">
            <Group title="Qog'oz turi">
              <Segmented
                className="w-full"
                value={style.paper}
                onChange={(value) => onStyle({ paper: value })}
                options={PAPER_OPTIONS}
              />
            </Group>

            <Group title="Varaq formati">
              <Segmented
                className="w-full"
                value={style.pageFormat}
                onChange={(value) => onStyle({ pageFormat: value })}
                options={PAGE_FORMAT_OPTIONS}
              />
            </Group>

            <Group title="Qo'shimcha">
              <Switch
                label="Qizil chegara chizig'i"
                checked={style.marginLine}
                onChange={(checked) => onStyle({ marginLine: checked })}
              />
              <Switch
                label="Matematika yozuvi (kasr, ildiz, daraja)"
                checked={style.mathMode}
                onChange={(checked) => onStyle({ mathMode: checked })}
              />
            </Group>
          </div>
        )}

        {panel === "notebook" && (
          <>
            <MiniAppWriter
              bundle={miniApp.state}
              onReload={(notebookId) => void miniApp.reloadState(notebookId)}
              startLine={startLine}
              onPickLine={onPickLine}
              onManage={miniApp.manageNotebook}
              busy={miniApp.notebookBusy}
            />
            <NotebookBook
              notebookId={miniApp.state.state?.activeId ?? null}
              title={
                miniApp.state.state?.notebooks.find(
                  (entry) => entry.id === miniApp.state.state?.activeId,
                )?.title ?? null
              }
              onManage={miniApp.manageNotebook}
              busy={miniApp.notebookBusy}
              refreshKey={`${miniApp.state.state?.activeId ?? ""}:${
                miniApp.state.state?.notebooks.find(
                  (entry) => entry.id === miniApp.state.state?.activeId,
                )?.usedSides ?? 0
              }`}
            />
            {side && (
              <p className="px-1 text-xs leading-relaxed text-pencil/70">
                {startLine
                  ? `${side.sideIndex + 1}-betning ${startLine}-qatoridan boshlanadi.`
                  : `Tanlanmasa — ${side.sideIndex + 1}-betning ${side.nextLine}-qatoridan davom etadi.`}
              </p>
            )}
          </>
        )}
      </main>

      {/* Pastdagi yopishib turadigan bo'limlar va yuborish tugmasi. */}
      <footer className="sticky bottom-0 z-30 border-t border-paper-edge/80 bg-paper/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md">
        {miniApp.send.status !== "idle" && miniApp.send.message && (
          <p
            className={cn(
              "flex items-start gap-2 border-b px-3 py-2 text-xs leading-relaxed",
              miniApp.send.status === "sent"
                ? "border-sage/30 bg-sage-soft/40 text-ink"
                : "border-margin/30 bg-margin-soft/40 text-margin",
            )}
          >
            {miniApp.send.status === "sent" ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span className="flex-1">{miniApp.send.message}</span>
          </p>
        )}

        <nav className="grid grid-cols-4 gap-1 px-2 pt-1.5">
          {PANELS.map((item) => {
            const Icon = item.icon;
            const active = panel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPanel(item.id)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-semibold transition-colors",
                  active ? "bg-ink/8 text-ink" : "text-pencil/60 hover:text-ink/80",
                )}
              >
                <Icon className={cn("h-4 w-4", active ? "text-marker" : "text-current")} />
                {item.label}
                {item.id === "notebook" && side && (
                  <span className="text-[10px] font-medium text-pencil/60">
                    {side.sideIndex + 1}-bet
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[11px] font-semibold text-ink">
              {startLine ? `${startLine}-qatordan` : "Oxiridan davom etadi"}
            </p>
            <p className="truncate text-[11px] text-pencil/65">
              {activeNotebook ? `${activeNotebook.title} · ${activeNotebook.usedSides}/${activeNotebook.capacity} bet` : "Daftar tanlanmagan"}
            </p>
          </div>
          <Button
            variant="marker"
            className="h-11 shrink-0 px-4"
            onClick={() => {
              setNotice(null);
              void miniApp.sendToChat({
                text,
                style,
                notebookId: activeNotebook?.id ?? undefined,
                startLine: startLine ?? undefined,
              });
            }}
            disabled={sending || trimmedLength === 0 || overLimit}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {sending ? "Yuborilmoqda…" : "Chatga yuborish"}
          </Button>
        </div>
      </footer>

      {/* Butun ekran ko'rinishi.
          Masshtab faqat tugmalar bilan o'zgaradi va kattalashtirilganda varaqa
          shu oynaning ichida siljiydi — sahifaning o'zi qimirlamaydi. */}
      {zoom && current && (
        <div
          role="dialog"
          aria-label={`${current.index}-varaq kattalashtirilgan`}
          className="fixed inset-0 z-50 flex flex-col gap-2 bg-ink/95 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]"
        >
          <div className="flex items-center justify-between gap-2 text-paper">
            <span className="min-w-0 truncate text-sm font-semibold">
              {current.index} / {current.total} varaq · {current.width}×{current.height}
            </span>
            <button
              type="button"
              onClick={() => setZoom(false)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-paper/25 px-2.5 py-1 text-xs font-semibold text-paper"
            >
              <X className="h-3.5 w-3.5" />
              Yopish
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-white">
            <img
              src={current.url}
              alt={`${current.index}-varaq`}
              className="mx-auto block"
              style={{ width: overlayScale === null ? "100%" : `${overlayScale}%` }}
            />
          </div>

          <div className="flex items-center justify-center gap-2 text-paper">
            <button
              type="button"
              title="Kichraytirish"
              aria-label="Kichraytirish"
              disabled={overlayScale === null}
              onClick={() => {
                if (overlayScale === null) return;
                const smaller = [...OVERLAY_ZOOM].reverse().find((step) => step < overlayScale);
                setOverlayScale(smaller ?? null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-paper/25 disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3.5rem] text-center text-xs font-semibold">
              {overlayScale === null ? "Sig'dirish" : `${overlayScale}%`}
            </span>
            <button
              type="button"
              title="Kattalashtirish"
              aria-label="Kattalashtirish"
              disabled={
                overlayScale !== null && overlayScale >= OVERLAY_ZOOM[OVERLAY_ZOOM.length - 1]
              }
              onClick={() => {
                if (overlayScale === null) {
                  setOverlayScale(OVERLAY_ZOOM.find((step) => step > 100) ?? 125);
                  return;
                }
                setOverlayScale(OVERLAY_ZOOM.find((step) => step > overlayScale) ?? overlayScale);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-paper/25 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={overlayScale === null}
              onClick={() => setOverlayScale(null)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-paper/25 px-2.5 text-xs font-semibold disabled:opacity-40"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Sig'dirish
            </button>
          </div>

          {pages.length > 1 && (
            <div className="flex items-center justify-center gap-2">
              {pages.map((page, index) => (
                <button
                  key={page.url}
                  type="button"
                  onClick={() => setActivePage(index)}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    index === safePage ? "w-6 bg-marker" : "w-1.5 bg-paper/50",
                  )}
                  aria-label={`${page.index}-varaq`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default MiniAppStudio;
