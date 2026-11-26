import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";

/** Quiet elevated surface used by every Home section. */
export function Surface({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-xl bg-card shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]", className)}>{children}</div>;
}

export function Panel({ title, description, action, children, className }: {
  title: string;
  description?: string;
  action?: { label: string; href: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <Surface className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-2 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && (
          <Link href={action.href} className="group inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            {action.label}
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className="min-w-0 flex-1 px-2 pb-2 sm:px-4 sm:pb-4">{children}</div>
    </Surface>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-xs text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && (
        <Link href={action.href} className="mt-2 inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/5">
          {action.label}
        </Link>
      )}
    </div>
  );
}

const avatarTones = ["bg-sky-100 text-sky-800", "bg-emerald-100 text-emerald-800", "bg-violet-100 text-violet-800", "bg-amber-100 text-amber-900", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];

export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = /[a-z]/i.test(name)
    ? name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()
    : name.replace(/[^\d]/g, "").slice(-2) || "?";
  const tone = avatarTones[[...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % avatarTones.length];
  return <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold", tone, className)}>{letters}</span>;
}

export function StatusDot({ tone }: { tone: "success" | "warning" | "neutral" }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-2 shrink-0 rounded-full ring-4", tone === "success" ? "bg-emerald-500 ring-emerald-500/15" : tone === "warning" ? "bg-amber-500 ring-amber-500/15" : "bg-zinc-300 ring-zinc-300/30")} />
  );
}

/** Short, scannable time: "now", "12m", "3h", "Yesterday", "12 Nov". Dates use the Indian locale Tany serves. */
export function shortTime(iso: string | null, now = Date.now()) {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`;
  if (minutes < 48 * 60) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(at);
}
