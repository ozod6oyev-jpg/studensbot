import { cn } from "@/lib/utils";

export type BadgeTone = "ink" | "marker" | "sage" | "margin";

export function Badge({
  className,
  tone = "ink",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  // `Record<BadgeTone, string>`: yangi ohang qo'shilib, rangi yozilmasa —
  // TypeScript shuni darhol aytadi (ilgari jimgina rangsiz badge chiqardi).
  const tones: Record<BadgeTone, string> = {
    ink: "bg-ink/8 text-ink",
    marker: "bg-marker-soft text-ink",
    sage: "bg-sage-soft text-sage",
    margin: "bg-margin-soft/60 text-margin",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string; hint?: string }[];
  className?: string;
}) {
  // `max-w-full` va `flex-wrap`: tor ekranda (Telegram oynasi) uzun variantlar
  // butun sahifani gorizontal siljitib yubormasin — ular keyingi qatorga o'tadi.
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap rounded-xl border border-ink/15 bg-white/70 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            title={option.hint}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
              active ? "bg-ink text-paper shadow-sm" : "text-ink/60 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Yoqish/o'chirish tugmasi (switch).
 *
 * Mini App'da checkbox mayda bo'lib qoladi va barmoq bilan bosish qiyin —
 * shuning uchun kattaroq, sirg'anadigan tugma ishlatiladi. Holat ekran
 * o'quvchiga `role="switch"` + `aria-checked` orqali aytiladi (faqat rang bilan
 * emas).
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left text-sm font-medium text-ink"
    >
      <span className="min-w-0">{label}</span>
      <span
        className={cn(
          "flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors",
          checked ? "bg-marker" : "bg-ink/15",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Ekran o'quvchi uchun nom (ko'rinadigan sarlavha yonida turadi). */
  label?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn(
        // `outline-none` faqat standart konturni olib tashlaydi: buning o'rniga
        // klaviatura bilan fokuslanganda ko'rinadigan halqa qo'yiladi, aks holda
        // surilma fokusda ekani bilinmay qolardi.
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-ink/15 accent-marker outline-none focus-visible:ring-2 focus-visible:ring-marker/60 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
        className,
      )}
    />
  );
}
