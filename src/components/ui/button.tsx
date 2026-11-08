import { forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-brand text-white hover:bg-brand-2 shadow-sm",
  secondary: "bg-surface text-ink border border-border hover:bg-muted shadow-sm",
  ghost: "text-ink-2 hover:bg-muted hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90 shadow-sm",
  "danger-outline": "border border-danger/30 text-danger hover:bg-danger-soft",
};
const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5", lg: "h-10 px-4" };

type Common = { variant?: keyof typeof variants; size?: keyof typeof sizes };
export const buttonClass = ({ variant = "primary", size = "md" }: Common = {}, extra?: string) =>
  cn("inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap", variants[variant], sizes[size], extra);

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & Common>(function Button(
  { variant, size, className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass({ variant, size }, className)} {...props} />;
});

export function LinkButton({ href, variant, size, className, children, ...rest }: Common & { href: string; className?: string; children: React.ReactNode; target?: string }) {
  return (
    <Link href={href} className={buttonClass({ variant, size }, className)} {...rest}>
      {children}
    </Link>
  );
}
