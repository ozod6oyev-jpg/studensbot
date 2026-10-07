import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-11 w-full rounded-xl border border-ink/15 bg-white/80 px-3.5 text-sm text-ink placeholder:text-ink/35 focus-visible:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marker/40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl border border-ink/15 bg-white/85 p-4 text-[15px] leading-relaxed text-ink placeholder:text-ink/35 focus-visible:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marker/40",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export const Label = forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("mb-1.5 block text-xs font-semibold uppercase tracking-wide text-pencil/70", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-11 w-full appearance-none rounded-xl border border-ink/15 bg-white/80 px-3.5 text-sm font-medium text-ink focus-visible:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marker/40",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
