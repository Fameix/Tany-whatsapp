"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { templateVariables } from "@/lib/templates/model";
import type { StarterTemplate } from "@/lib/templates/starters";
import { copyStarterTemplate } from "./actions";
import { CategoryBadge, TemplatePreview } from "./template-preview";

function StarterCard({ starter, businessId, root }: { starter: StarterTemplate; businessId: string; root: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const variables = templateVariables(starter.body);
  const use = () => startTransition(async () => {
    setError("");
    const result = await copyStarterTemplate(businessId, starter.key);
    if (result.ok) router.push(`${root}/${encodeURIComponent(result.id)}`);
    else setError(result.message);
  });
  return (
    <article className="flex min-w-0 flex-col rounded-xl bg-card shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]">
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{starter.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{starter.purpose}</p>
        </div>
        <CategoryBadge category={starter.category} />
      </div>
      <TemplatePreview body={starter.body} buttons={starter.buttons} examples={starter.examples} compact className="mx-4 mt-4" />
      <dl className="mx-4 mt-4 flex flex-col gap-1 text-xs">
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Variables</dt><dd className="min-w-0 text-foreground/80">{variables.length ? variables.map(n => `{{${n}}} ${starter.examples[n - 1]}`).join(" · ") : "None"}</dd></div>
        <div className="flex gap-2"><dt className="w-16 shrink-0 text-muted-foreground">Buttons</dt><dd className="min-w-0 text-foreground/80">{starter.buttons.length ? starter.buttons.map(button => button.text).join(" · ") : "None"}</dd></div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-2 px-4 pt-4 pb-4">
        <code className="truncate text-[11px] text-muted-foreground">{starter.key}</code>
        <Button size="sm" onClick={use} disabled={pending} aria-label={`Use the ${starter.title} template`}>
          {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
          Use template
        </Button>
      </div>
      {error && <p role="alert" className="px-4 pb-4 text-xs text-primary">{error}</p>}
    </article>
  );
}

export function StarterLibrary({ starters, businessId, root, productLabel }: { starters: StarterTemplate[]; businessId: string; root: string; productLabel: string }) {
  if (!starters.length)
    return <p className="rounded-xl bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow-[0_0_0_1px_rgb(9_9_11/0.06)]">Starter templates for {productLabel} are coming soon. You can still create a template from scratch.</p>;
  const groups = (["utility", "marketing"] as const).map(category => ({ category, items: starters.filter(starter => starter.category === category) })).filter(group => group.items.length);
  return (
    <div className="flex flex-col gap-8">
      <p className="rounded-lg bg-muted/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
        Starter templates are ready-made drafts for {productLabel}. Using one creates a draft for your business that you can edit and then submit to Meta. Templates can only be sent after Meta approves them.
      </p>
      {groups.map(group => (
        <section key={group.category} aria-labelledby={`starters-${group.category}`} className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2">
            <h2 id={`starters-${group.category}`} className="text-sm font-semibold tracking-tight">{group.category === "utility" ? "Utility" : "Marketing"}</h2>
            <span className="text-xs text-muted-foreground">{group.category === "utility" ? "Order, payment and appointment updates" : "Offers, follow-ups and feedback"} · {group.items.length}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map(starter => <StarterCard key={starter.key} starter={starter} businessId={businessId} root={root} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
