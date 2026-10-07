import { cn } from "@/lib/utils";

export interface PaperMockProps {
  variant?: "lined" | "grid";
  title?: string;
  lines?: string[];
  ink?: string;
  className?: string;
}

/**
 * Sof CSS bilan yasalgan "yozilgan daftar varaqasi" — landing sahifasida
 * haqiqiy render qilingan rasmning o'rnini bosadi.
 */
export function PaperMock({
  variant = "lined",
  title,
  lines = [],
  ink = "#1B3E8F",
  className,
}: PaperMockProps) {
  const isGrid = variant === "grid";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-paper-edge shadow-paper",
        isGrid ? "paper-grid" : "paper-lined",
        className,
      )}
    >
      {/* Varaqaning chap tomonidagi soya — qalin daftar taassuroti */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black/10 to-transparent" />

      {/* Qizil chegara chizig'i */}
      <div className="pointer-events-none absolute inset-y-0 left-[68px] w-[1.5px] bg-margin-soft" />

      <div className={cn("relative py-5 pr-6", isGrid ? "pl-[88px]" : "pl-20")}>
        {title ? (
          <p className="hand mb-1 text-[18px] leading-7 text-pencil/60">{title}</p>
        ) : null}

        <div>
          {lines.map((line, index) => (
            <p
              key={`${line}-${index}`}
              className={cn(
                "hand whitespace-nowrap text-[21px]",
                isGrid ? "leading-[56px]" : "leading-[28px]",
              )}
              style={{ color: ink }}
            >
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* Pastki ochiq gradient — varaqa davom etayotgandek ko'rinadi */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white/70 to-transparent" />
    </div>
  );
}

export default PaperMock;
