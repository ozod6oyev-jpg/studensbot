import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, PenLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Segmented } from "@/components/ui/controls";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { pngToObjectUrl, renderNotebookInBrowser } from "@/lib/handwriting/browser";
import { FONT_LIBRARY, type FontCategory, type FontLibraryEntry } from "@/lib/handwriting/fonts.generated";
import { FONT_CATEGORIES, SUBJECT_PRESETS, categoryLabel } from "@/lib/handwriting/options";

type TabId = "all" | FontCategory;

const MAX_PARALLEL = 4;

/**
 * Namuna rasmlari kesh: bitta shrift bir marta chiziladi va shu sessiya
 * davomida qayta ishlatiladi (tab almashtirilganda ham qayta chizilmaydi,
 * shuning uchun object URL'lar ataylab bekor qilinmaydi).
 */
const previewCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

let activeRenders = 0;
const waiting: (() => void)[] = [];

/** Bir vaqtda ko'pi bilan 4 ta render — brauzer qotib qolmasligi uchun. */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  }
  activeRenders += 1;
  try {
    return await task();
  } finally {
    activeRenders -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

/** Shrift uchun kichik namuna varaqasini chizadi (kerak bo'lsa navbatga turadi). */
function fontPreview(entry: FontLibraryEntry): Promise<string> {
  const cached = previewCache.get(entry.id);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(entry.id);
  if (running) return running;

  const promise = withSlot(async () => {
    const sample = entry.cyrillic ? "Абв Salom x^2" : "Abc Salom x^2";
    const result = await renderNotebookInBrowser(sample, {
      paper: "plain",
      pageFormat: "strip",
      fontSize: 34,
      lineGap: 56,
      marginLine: false,
      marginLeft: 60,
      wobble: 0.5,
      seed: 5,
      mathMode: true,
      font: entry.id,
    });
    const page = result.pages[0];
    if (!page) throw new Error("Namuna chizilmadi");
    const url = pngToObjectUrl(page.png);
    previewCache.set(entry.id, url);
    return url;
  });

  inFlight.set(entry.id, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => inFlight.delete(entry.id));

  return promise;
}

function FontTile({
  entry,
  selected,
  onSelect,
}: {
  entry: FontLibraryEntry;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(() => previewCache.get(entry.id) ?? null);
  const [failed, setFailed] = useState(false);
  /** Plitka ekranga yaqinlashganda `true` bo'ladi (namuna shundan keyin chiziladi). */
  const [nearView, setNearView] = useState(() => typeof IntersectionObserver === "undefined");
  const tileRef = useRef<HTMLButtonElement | null>(null);

  // Galereya ochilganda 39 ta namuna birdan chizilsa, sahifa bir zumga qotib
  // qoladi. Shuning uchun namuna faqat plitka ko'rinadigan joyga kelganda
  // so'raladi (ko'rinmas plitkalar navbatni egallamaydi).
  useEffect(() => {
    if (nearView || url) return;
    const node = tileRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setNearView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setNearView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [nearView, url]);

  useEffect(() => {
    if (url || !nearView) return;
    let cancelled = false;
    fontPreview(entry)
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [entry, url, nearView]);

  return (
    <button
      ref={tileRef}
      type="button"
      aria-pressed={selected}
      title={entry.label}
      onClick={() => onSelect(entry.id)}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-white/80 p-2 text-left transition-all hover:-translate-y-0.5",
        selected ? "border-marker ring-2 ring-marker/40" : "border-paper-edge hover:border-ink/25",
      )}
    >
      <span className="relative flex h-[72px] items-center justify-center overflow-hidden rounded-lg border border-paper-edge/70 bg-paper">
        {url ? (
          <img src={url} alt={`${entry.label} namunasi`} className="h-full w-full object-contain" />
        ) : failed ? (
          <span className="text-[11px] text-pencil/50">namuna yo'q</span>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-ink/40" />
        )}
        {selected && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-marker text-ink">
            <Check className="h-3 w-3" />
          </span>
        )}
      </span>

      <span className="mt-2 block truncate text-sm font-semibold text-ink">{entry.label}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1">
        <Badge className="px-2 py-0.5 text-[10px]">{categoryLabel(entry.category)}</Badge>
        {entry.cyrillic && (
          <Badge tone="sage" className="px-2 py-0.5 text-[10px]">
            kirill
          </Badge>
        )}
        <code className="rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[10px] text-ink/70">
          {entry.id}
        </code>
      </span>
    </button>
  );
}

/**
 * Qo'lyozma shriftlari galereyasi: har bir plitkada shu shrift bilan chizilgan
 * haqiqiy namuna ko'rsatiladi.
 */
/**
 * Galereya `memo` bilan o'ralgan: Studio'da har bir tugma bosilganda yoki matn
 * o'zgarganda u qayta chizilmasligi kerak (39 ta plitka qimmat turadi).
 */
export const FontGallery = memo(function FontGallery({
  value,
  onChange,
  onPreset,
}: {
  value: string;
  onChange: (id: string) => void;
  onPreset?: (presetId: "adabiyot" | "matematika") => void;
}) {
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");

  const tabs: { id: TabId; label: string; hint?: string }[] = useMemo(
    () => [{ id: "all", label: "Hammasi" }, ...FONT_CATEGORIES.map((item) => ({ id: item.id, label: item.label, hint: item.hint }))],
    [],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FONT_LIBRARY.filter((entry) => {
      if (tab !== "all" && entry.category !== tab) return false;
      if (!needle) return true;
      return `${entry.family} ${entry.id} ${entry.label}`.toLowerCase().includes(needle);
    });
  }, [tab, query]);

  const cyrillicCount = useMemo(() => FONT_LIBRARY.filter((entry) => entry.cyrillic).length, []);
  const tiles = useMemo(
    () =>
      filtered.map((entry) => (
        <FontTile key={entry.id} entry={entry} selected={entry.id === value} onSelect={onChange} />
      )),
    [filtered, value, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone="marker">
          <PenLine className="h-3.5 w-3.5" />
          {FONT_LIBRARY.length} shrift • {cyrillicCount} tasi kirillcha
        </Badge>
        <div className="flex flex-wrap gap-2">
          {SUBJECT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant="outline"
              size="sm"
              title={preset.hint}
              onClick={() => {
                onChange(preset.style.font);
                onPreset?.(preset.id);
              }}
            >
              {preset.label} uchun tayyor
            </Button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/35" />
        <Input
          value={query}
          type="search"
          aria-label="Shrift nomini qidirish"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Shrift nomini qidirish…"
          className="pl-9"
        />
      </div>

      <Segmented className="flex-wrap" value={tab} onChange={setTab} options={tabs} />

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-paper-edge bg-white/60 p-4 text-sm text-pencil/75">
          Bu shartga mos shrift topilmadi — qidiruvni o'zgartirib ko'ring.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{tiles}</div>
      )}
    </div>
  );
});

export default FontGallery;
