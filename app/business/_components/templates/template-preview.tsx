import { CornerUpLeft, ExternalLink, Phone } from "lucide-react";
import { cn } from "cn";
import type { TemplateButton, TemplateCategory, TemplateStatus } from "@/lib/templates/model";

/** Splits text on {{n}} so variables can be highlighted, filled with examples when available. */
function bodyParts(body: string, examples: string[]) {
  return body.split(/(\{\{\d+\}\})/g).map((part, index) => {
    const match = /^\{\{(\d+)\}\}$/.exec(part);
    if (!match) return <span key={index}>{part}</span>;
    const example = examples[Number(match[1]) - 1]?.trim();
    return <span key={index} className={cn("rounded px-0.5", example ? "bg-emerald-600/10 text-emerald-900" : "bg-amber-500/15 font-mono text-[12px] text-amber-900")}>{example || part}</span>;
  });
}

const buttonIcon = { QUICK_REPLY: CornerUpLeft, URL: ExternalLink, PHONE_NUMBER: Phone } as const;

/** WhatsApp-style rendering of a template message. */
export function TemplatePreview({ header, body, footer, buttons, examples, className, compact = false }: {
  header?: string; body: string; footer?: string; buttons: TemplateButton[]; examples: string[]; className?: string; compact?: boolean;
}) {
  return (
    <div className={cn("rounded-xl bg-[#efe7dd] p-3", compact ? "" : "p-4", className)} aria-label="WhatsApp message preview">
      <div className="max-w-[300px] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]">
        <div className="px-3 pt-2 pb-1.5">
          {header?.trim() && <p className="mb-1 text-sm font-semibold text-zinc-900">{header}</p>}
          <p className={cn("whitespace-pre-wrap break-words text-zinc-900", compact ? "text-[12.5px] leading-[18px]" : "text-[13.5px] leading-5")}>
            {body.trim() ? bodyParts(body, examples) : <span className="text-zinc-400">Your message appears here</span>}
          </p>
          {footer?.trim() && <p className="mt-1 text-[11.5px] text-zinc-500">{footer}</p>}
          <p className="mt-0.5 text-right text-[10.5px] text-zinc-400">10:24</p>
        </div>
        {buttons.length > 0 && (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
            {buttons.map((button, index) => {
              const Icon = buttonIcon[button.type];
              return (
                <li key={index} className="flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium text-[#027eb5]">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {button.text || "Button"}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const statusStyle: Record<TemplateStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-zinc-100 text-zinc-700" },
  pending: { label: "In review", className: "bg-amber-500/10 text-amber-800" },
  approved: { label: "Approved", className: "bg-emerald-500/10 text-emerald-800" },
  rejected: { label: "Rejected", className: "bg-primary/10 text-primary" },
};

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const { label, className } = statusStyle[status];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-medium", className)}>{label}</span>;
}

export function CategoryBadge({ category }: { category: TemplateCategory | "unknown" }) {
  const label = category === "unknown" ? "Uncategorised" : category[0].toUpperCase() + category.slice(1);
  return <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">{label}</span>;
}
