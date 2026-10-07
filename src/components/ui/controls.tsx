import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "ink",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "ink" | "marker" | "sage" | "margin" }) {
  const tones: Record<string, string> = {
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
  return (
    <div className={cn("inline-flex rounded-xl border border-ink/15 bg-white/70 p-1", className)}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            title={option.hint}
            onClick={() => onChange(option.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
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

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-ink/15 accent-marker outline-none",
        className,
      )}
    />
  );
}
