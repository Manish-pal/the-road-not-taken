import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "gold" | "ghost" | "quiet";

export function Button({
  variant = "ghost",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors duration-150",
        "disabled:cursor-default disabled:opacity-40",
        variant === "gold" && "border-transparent bg-gold text-ink hover:opacity-90",
        variant === "ghost" && "border-line bg-panel text-fg hover:bg-bg",
        variant === "quiet" && "border-transparent bg-transparent px-2 text-muted hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
