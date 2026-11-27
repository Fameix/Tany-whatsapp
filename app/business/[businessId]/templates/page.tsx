import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Plus } from "lucide-react";
import { cn } from "cn";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { loadBusiness } from "@/app/business/_components/load-business";
import { StarterLibrary } from "@/app/business/_components/templates/starter-library";
import { TemplateList } from "@/app/business/_components/templates/template-list";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import { refreshPendingTemplates } from "@/lib/templates/meta-templates";
import { renderTemplateBody } from "@/lib/templates/model";
import { listBusinessTemplates, TemplateStoreUnavailableError } from "@/lib/templates/repository";
import { startersFor } from "@/lib/templates/starters";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function Templates({ params, searchParams }: Props) {
  await connection();
  const { businessId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  const business = await loadBusiness(businessId);
  const view = (await searchParams).view === "starters" ? "starters" : "mine";
  const root = `/business/${encodeURIComponent(businessId)}/templates`;
  const productLabel = verticalConfig[business.vertical]?.label ?? "your business";

  let templates;
  try {
    templates = await listBusinessTemplates(businessId);
    // Show Meta's latest review result for templates still in review.
    if (view === "mine" && (await refreshPendingTemplates(businessId, templates).catch(() => false))) templates = await listBusinessTemplates(businessId);
  } catch (error) {
    if (error instanceof TemplateStoreUnavailableError) return <p className="p-6 text-sm text-muted-foreground">Templates are not available in this environment.</p>;
    throw error;
  }

  const tab = (value: "mine" | "starters", label: string, count: number) => (
    <Link href={value === "starters" ? `${root}?view=starters` : root} aria-current={view === value ? "page" : undefined}
      className={cn("inline-flex h-9 items-center gap-2 border-b-2 px-1 text-sm font-medium transition-colors", view === value ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
      {label}<span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <header className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">Create and manage WhatsApp-approved messages.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {view === "mine" && <Link href={`${root}?view=starters`} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted">Browse starter templates</Link>}
          <Link href={`${root}/new`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"><Plus className="size-4" aria-hidden="true" />Create template</Link>
        </div>
      </header>
      <nav aria-label="Template views" className="-mt-2 flex gap-6 border-b border-border/70">
        {tab("mine", "Your templates", templates.length)}
        {tab("starters", `${productLabel} starters`, startersFor(business.vertical).length)}
      </nav>
      {view === "starters"
        ? <StarterLibrary starters={startersFor(business.vertical)} businessId={businessId} root={root} productLabel={productLabel} />
        : <TemplateList root={root} templates={templates.map(template => ({
          id: template.id, name: template.name, category: template.storedCategory, status: template.status, language: template.language,
          preview: renderTemplateBody(template.body, template.examples).replace(/\s+/g, " ").trim(), rejectionReason: template.rejectionReason, updatedAt: template.updatedAt,
        }))} />}
    </div>
  );
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Templates {...props} /></Suspense>;
}
