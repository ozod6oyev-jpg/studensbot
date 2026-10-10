import { useState } from "react";
import { Check, FileDown, Loader2, Pencil, Plus, RefreshCw, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Segmented } from "@/components/ui/controls";
import { Input, Label } from "@/components/ui/form";
import { useNotebookRender } from "@/hooks/use-notebook-render";
import type { MiniAppStateBundle } from "@/hooks/use-mini-app";
import { lineRowsFor } from "@/lib/handwriting/layout";
import { PAPER_OPTIONS, pageSizeFor } from "@/lib/handwriting/options";
import { DEFAULT_STYLE, type PaperType } from "@/lib/handwriting/types";
import type { MiniAppNotebookPayload, MiniAppNotebookResult } from "@/lib/telegram/mini-app";
import { cn } from "@/lib/utils";

/**
 * Botdagi `TITLE_MAX` (`bot/db.ts`) bilan bir xil: undan uzun nom botda
 * jimgina qisqartirilardi, shuning uchun maydon ham shu chegarani ko'rsatadi.
 */
const TITLE_MAX = 40;

/** Botdagi `SHEET_CHOICES` bilan bir xil varaq sonlari. */
const SHEET_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "12", label: "12", hint: "12 varaq — 24 bet, qisqa ishlar uchun" },
  { id: "36", label: "36", hint: "36 varaq — 72 bet, choraklik ishlar uchun" },
  { id: "48", label: "48", hint: "48 varaq — 96 bet" },
  { id: "96", label: "96", hint: "96 varaq — 192 bet, butun o'quv yili uchun" },
];

export interface MiniAppWriterProps {
  /** Botdan olingan daftarlar ro'yxati va joriy bet holati. */
  bundle: MiniAppStateBundle;
  /** Daftarni tanlash (yoki ro'yxatni qayta o'qish) — botdagi ochiq daftar ham o'sha bo'ladi. */
  onReload: (notebookId?: string | null) => void;
  /** Tanlangan qator (1 dan); hali tanlanmagan bo'lsa — `null`. */
  startLine: number | null;
  /** Varaqadagi qatorni tanlash. */
  onPickLine: (line: number) => void;
  /**
   * Daftar amali: yaratish, nomlash, o'chirish, orqaga qaytarish yoki PDF
   * kitob. Natija qaytariladi (xato ham) — shu sababli UI yiqilmaydi.
   */
  onManage: (payload: MiniAppNotebookPayload) => Promise<MiniAppNotebookResult>;
  /** Daftar amali bajarilmoqda — tugmalar shu vaqtda bloklanadi. */
  busy: boolean;
}

/** Daftar amali natijasi (xabar bilan) — foydalanuvchiga ko'rsatiladi. */
interface ManageOutcome {
  ok: boolean;
  message: string;
}

/**
 * Mini App'da yozishdan oldingi qadam: daftar tanlanadi va qatordan boshlash
 * **daftar varaqasining o'zida** belgilanadi.
 *
 * Varaqa botdan olingan joriy bet matni bilan shu yerda chiziladi, ustiga esa
 * `lineRowsFor()` bergan qator bandlari qo'yiladi — ular chizilgan chiziqlar
 * bilan bir xil geometriyadan hisoblanadi. Band qatorlar (yozuv bor joylar)
 * tanlanmaydi, faqat bo'sh qatorlar bosiladi.
 *
 * Daftar bilan bog'liq ishlar (yangi daftar, nom, o'chirish, orqaga qaytarish,
 * PDF kitob) shu kartaning o'zida bajariladi: ular bot chatidagi tugmalar bilan
 * bir xil, faqat natija chatga emas — shu yerga qaytadi.
 */
export function MiniAppWriter({
  bundle,
  onReload,
  startLine,
  onPickLine,
  onManage,
  busy,
}: MiniAppWriterProps) {
  const state = bundle.state;
  const side = state?.side ?? null;
  const style = { ...DEFAULT_STYLE, ...(state?.style ?? {}) };
  const pageSize = pageSizeFor(style.pageFormat);
  const rows = lineRowsFor(style.pageFormat, style.lineGap);
  // Bet bo'sh bo'lsa rasm chizilmaydi — o'rniga varaqa foni ko'rsatiladi.
  const rendered = useNotebookRender(side?.text ?? "", style);
  const page = rendered.pages[0];

  /** Ochilgan kichik shakl: yangi daftar, nomlash yoki o'chirishni tasdiqlash. */
  const [mode, setMode] = useState<"idle" | "create" | "rename" | "remove">("idle");
  const [sheetCount, setSheetCount] = useState<string>("12");
  const [paper, setPaper] = useState<PaperType>(style.paper);
  const [newTitle, setNewTitle] = useState("");
  const [renameTitle, setRenameTitle] = useState("");
  const [outcome, setOutcome] = useState<ManageOutcome | null>(null);

  const active = state?.notebooks.find((notebook) => notebook.id === state.activeId) ?? null;

  /** Amalni bajarib, natija xabarini ko'rsatadi (ro'yxat hook tomonida yangilanadi). */
  const run = async (payload: MiniAppNotebookPayload): Promise<ManageOutcome> => {
    const result = await onManage(payload);
    const next: ManageOutcome = { ok: result.ok, message: result.message };
    setOutcome(next);
    return next;
  };

  const openCreate = () => {
    setSheetCount("12");
    setPaper(style.paper);
    setNewTitle("");
    setOutcome(null);
    setMode("create");
  };

  const submitCreate = async () => {
    const title = newTitle.trim();
    const result = await run({
      action: "create",
      sheets: Number(sheetCount),
      paper,
      ...(title ? { title } : {}),
    });
    if (result.ok) {
      setMode("idle");
      setNewTitle("");
    }
  };

  const submitRename = async () => {
    if (!active) return;
    const result = await run({ action: "rename", notebookId: active.id, title: renameTitle.trim() });
    if (result.ok) setMode("idle");
  };

  const submitRemove = async () => {
    if (!active) return;
    const result = await run({ action: "remove", notebookId: active.id });
    if (result.ok) setMode("idle");
  };

  return (
    <Card className="bg-white/70">
      <CardHeader>
        <CardTitle className="hand text-2xl">Qayerga yozamiz?</CardTitle>
        <CardDescription>
          Yozishdan oldin daftar tanlanadi; qatordan boshlashni varaqaning o'zida belgilaysiz.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {bundle.status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-pencil/75">
            <Loader2 className="h-4 w-4 animate-spin" />
            Daftarlar yuklanmoqda…
          </p>
        )}

        {bundle.status === "error" && (
          <div className="space-y-2 rounded-xl border border-margin/40 bg-margin-soft/40 p-3 text-sm text-margin">
            <p>{bundle.message ?? "Daftarlar ro'yxatini olib bo'lmadi."}</p>
            <Button variant="outline" size="sm" onClick={() => onReload()}>
              <RefreshCw className="h-4 w-4" />
              Qayta urinish
            </Button>
          </div>
        )}

        {state && state.notebooks.length === 0 && (
          <p className="rounded-xl border border-paper-edge bg-white/60 p-3 text-sm leading-relaxed text-pencil/80">
            Hozircha daftar yo'q. Quyidagi{" "}
            <span className="font-semibold text-ink">➕ Yangi daftar</span> bilan daftarni shu
            yerda yaratasiz — varaq soni va qog'oz turini o'zingiz tanlaysiz.
          </p>
        )}

        {state && state.notebooks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {state.notebooks.map((notebook) => {
              const isActive = notebook.id === state.activeId;
              return (
                <button
                  key={notebook.id}
                  type="button"
                  onClick={() => {
                    // Boshqa daftarga o'tiladi: oldingi daftar haqidagi natija
                    // xabari va ochiq shakl yangi daftarga tegishli bo'lmaydi.
                    setOutcome(null);
                    setMode("idle");
                    onReload(notebook.id);
                  }}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition-all",
                    isActive
                      ? "border-marker bg-marker-soft/40 ring-2 ring-marker/30"
                      : "border-ink/15 bg-white hover:border-ink/35",
                  )}
                >
                  <span className="block text-sm font-semibold text-ink">{notebook.title}</span>
                  <span className="block text-[11px] text-pencil/70">
                    {notebook.usedSides}/{notebook.capacity} bet · {notebook.sheets} varaq
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {state && (
          <div className="space-y-3 rounded-xl border border-paper-edge bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-pencil/60">
                Daftar bilan ishlash
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => (mode === "create" ? setMode("idle") : openCreate())}
              >
                <Plus className="h-4 w-4" />
                Yangi daftar
              </Button>
            </div>

            {mode === "create" && (
              <div className="space-y-3 rounded-xl border border-marker/40 bg-marker-soft/20 p-3">
                <div>
                  <Label>Varaq soni</Label>
                  <Segmented
                    className="w-full"
                    value={sheetCount}
                    onChange={setSheetCount}
                    options={SHEET_OPTIONS}
                  />
                </div>
                <div>
                  <Label>Qog'oz turi</Label>
                  <Segmented
                    className="w-full"
                    value={paper}
                    onChange={setPaper}
                    options={PAPER_OPTIONS}
                  />
                </div>
                <div>
                  <Label>Nom (ixtiyoriy)</Label>
                  <Input
                    value={newTitle}
                    maxLength={TITLE_MAX}
                    placeholder="Masalan: Matematika 8-sinf"
                    onChange={(event) => setNewTitle(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="marker" size="sm" disabled={busy} onClick={() => void submitCreate()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Yaratish
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode("idle")}>
                    Bekor qilish
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-pencil/65">
                  Yangi daftar darhol ochiq bo'ladi — keyingi yuborilgan matn shunga yoziladi.
                </p>
              </div>
            )}

            {!active && mode !== "create" && (
              <p className="text-xs leading-relaxed text-pencil/65">
                Amallar (nom, o'chirish, PDF) uchun avval yuqoridan daftar tanlang.
              </p>
            )}

            {active && mode === "idle" && (
              <div className="space-y-2">
                <p className="text-xs text-pencil/70">
                  Tanlangan daftar:{" "}
                  <span className="font-semibold text-ink">{active.title}</span> — amallar shu
                  daftarga tegishli.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setRenameTitle(active.title);
                      setMode("rename");
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Nom
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run({ action: "undo", notebookId: active.id })}
                  >
                    <Undo2 className="h-4 w-4" />
                    Orqaga
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run({ action: "book", notebookId: active.id })}
                  >
                    <FileDown className="h-4 w-4" />
                    PDF kitob
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-margin hover:bg-margin-soft/40"
                    disabled={busy}
                    onClick={() => setMode("remove")}
                  >
                    <Trash2 className="h-4 w-4" />
                    O'chirish
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-pencil/65">
                  ↩️ Orqaga — oxirgi yozuv yoki o'chirishni bekor qiladi. ⬇️ PDF kitob — yozilgan
                  betlar chatga kitob bo'lib yuboriladi.
                </p>
              </div>
            )}

            {active && mode === "rename" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[180px] flex-1">
                  <Label>Yangi nom</Label>
                  <Input
                    value={renameTitle}
                    maxLength={TITLE_MAX}
                    autoFocus
                    onChange={(event) => setRenameTitle(event.target.value)}
                  />
                </div>
                <Button
                  variant="marker"
                  size="sm"
                  disabled={busy || renameTitle.trim().length === 0}
                  onClick={() => void submitRename()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Saqlash
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode("idle")}>
                  Bekor qilish
                </Button>
              </div>
            )}

            {active && mode === "remove" && (
              <div className="space-y-2 rounded-xl border border-margin/40 bg-margin-soft/30 p-3">
                <p className="text-sm leading-relaxed text-margin">
                  «{active.title}» butunlay o'chiriladi — yozilgan betlar ham o'chadi. Bu amalni
                  orqaga qaytarib bo'lmaydi.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="default" size="sm" disabled={busy} onClick={() => void submitRemove()}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Ha, o'chirish
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode("idle")}>
                    <X className="h-4 w-4" />
                    Yo'q
                  </Button>
                </div>
              </div>
            )}

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
          </div>
        )}

        {side && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="marker">{side.sideIndex + 1}-bet</Badge>
              <span className="text-xs text-pencil/70">
                jami {side.sideCount} bet · {side.usedLines} qator band · {side.freeLines} qator bo'sh
              </span>
            </div>

            <p className="text-xs text-pencil/65">
              Boshlanish qatorini varaqaning o'zida bosing — rasmdagi raqamlar qator raqami.
            </p>

            <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-paper-edge bg-white shadow-paper">
              {page ? (
                <img src={page.url} alt={`${side.sideIndex + 1}-bet`} className="w-full" />
              ) : (
                <div
                  className="paper-lined w-full"
                  style={{ aspectRatio: `${pageSize.width} / ${pageSize.height}` }}
                />
              )}

              {rows.map((row, index) => {
                const line = index + 1;
                const locked = line < side.nextLine;
                const selected = startLine === line;
                return (
                  <button
                    key={line}
                    type="button"
                    disabled={locked}
                    title={locked ? "bu qatorda yozuv bor" : `${line}-qator`}
                    onClick={() => onPickLine(line)}
                    style={{
                      top: `${(row.top / pageSize.height) * 100}%`,
                      height: `${(row.height / pageSize.height) * 100}%`,
                    }}
                    className={cn(
                      "absolute inset-x-0 flex items-center border-l-2 pl-1 text-left transition-colors",
                      locked
                        ? "cursor-not-allowed border-transparent opacity-40"
                        : "border-marker/40 hover:bg-marker/15",
                      selected && "border-marker bg-marker/25 ring-1 ring-marker/60",
                    )}
                  >
                    <span className="rounded bg-white/85 px-1 text-[10px] font-semibold text-pencil/70">
                      {line}
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-xs leading-relaxed text-pencil/70">
              {startLine
                ? `Yozish ${startLine}-qatordan boshlanadi.`
                : `Tanlanmasa — oxirgi yozuv tagidan (${side.nextLine}-qator) davom etadi.`}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default MiniAppWriter;
