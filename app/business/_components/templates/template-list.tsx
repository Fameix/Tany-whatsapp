"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, LayoutTemplate } from "lucide-react";
import { cn } from "cn";
import type { TemplateCategory, TemplateStatus } from "@/lib/templates/model";
import { CategoryBadge, TemplateStatusBadge } from "./template-preview";

export type TemplateListItem = {
  id: string; name: string; category: TemplateCategory | "unknown"; status: TemplateStatus; language: string;
  preview: string; rejectionReason: string | null; updatedAt: string | null;
};

const categories: Array<{ value: "all" | TemplateCategory; label: string }> = [
  { value: "all", label: "All" }, { value: "utility", label: "Utility" }, { value: "marketing", label: "Marketing" }, { value: "authentication", label: "Authentication" },
];
const statuses: Array<{ value: "any" | TemplateStatus; label: string }> = [
  { value: "any", label: "Any status" }, { value: "draft", label: "Draft" }, { value: "pending", label: "In review" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" },
];

function Segmented<T extends string>({ label, options, value, onChange, counts }: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; counts: Record<string, number> }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted/70 p-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors", value === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {option.label}
          {counts[option.value] !== undefined && <span className="tabular-nums text-muted-foreground">{counts[option.value]}</span>}
        </button>
      ))}
    </div>
  );
}

const updated = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "");

export function TemplateList({ templates, root }: { templates: TemplateListItem[]; root: string }) {
  const [category, setCategory] = useState<"all" | TemplateCategory>("all");
  const [status, setStatus] = useState<"any" | TemplateStatus>("any");
  const inCategory = templates.filter(template => category === "all" || template.category === category);
  const visible = inCategory.filter(template => status === "any" || template.status === status);
  const categoryCounts = Object.fromEntries(categories.map(option => [option.value, templates.filter(t => option.value === "all" || t.category === option.value).length]));
  const statusCounts = Object.fromEntries(statuses.map(option => [option.value, inCategory.filter(t => option.value === "any" || t.status === option.value).length]));

  if (!templates.length)
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-12 text-center shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><LayoutTemplate className="size-5" aria-hidden="true" /></span>
        <p className="mt-2 text-sm font-semibold">No templates yet</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">Start from a ready-made template for your business, customise it, then submit it to Meta for approval.</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href={`${root}?view=starters`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">Browse starter templates</Link>
          <Link href={`${root}/new`} className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-muted">Start from scratch</Link>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Segmented label="Category" options={categories} value={category} onChange={setCategory} counts={categoryCounts} />
        <Segmented label="Status" options={statuses} value={status} onChange={setStatus} counts={statusCounts} />
      </div>
      <div className="overflow-hidden rounded-xl bg-card shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]">
        {visible.length ? (
          <ul className="divide-y divide-border/60">
            {visible.map(template => (
              <li key={template.id}>
                <Link href={`${root}/${encodeURIComponent(template.id)}`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-mono text-[13px] font-medium">{template.name}</p>
                      <span className="text-xs text-muted-foreground">{template.language}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{template.preview || "No message yet"}</p>
                    {template.status === "rejected" && template.rejectionReason && <p className="mt-1 line-clamp-1 text-xs text-primary">Meta: {template.rejectionReason}</p>}
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    <CategoryBadge category={template.category} />
                  </div>
                  <TemplateStatusBadge status={template.status} />
                  <span className="hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:block">{updated(template.updatedAt)}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">No templates match these filters.</p>
        )}
      </div>
    </div>
  );
}
