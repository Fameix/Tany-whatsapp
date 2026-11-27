import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { cn } from "cn";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { BusinessTable, EmptyPanel, PageHeader, isSuperAdmin } from "@/app/admin/components/control-center/ui";
import { ToggleActive } from "@/app/admin/components/control-center/toggle-active";
import { listProductBusinesses } from "@/lib/admin/product-center";
import { tenantKindLabel, type TenantKind } from "@/lib/admin/tenant-classification";
import { tanyProducts } from "@/lib/messaging/vertical-config";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const kinds: TenantKind[] = ["test", "demo", "migration"];

/** Test, demo and migration tenants, kept out of product metrics. Nothing here is deleted automatically. */
async function TestAndStaging({ searchParams }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <DashboardAccessRequired />;
  const query = await searchParams;
  const product = typeof query.product === "string" && tanyProducts.some(p => p.id === query.product) ? query.product : null;
  const tenants = (await listProductBusinesses()).filter(business => business.kind !== "live" && (!product || business.product === product));
  const filter = (value: string | null, label: string) => (
    <Link key={value ?? "all"} href={value ? `/admin/system?product=${value}` : "/admin/system"} aria-current={product === value ? "page" : undefined}
      className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium", product === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <PageHeader title="Test & staging" description="Test, demo and migration tenants. They're excluded from product metrics and business lists." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/70 p-1" role="navigation" aria-label="Filter by product">
          {filter(null, "All")}{tanyProducts.filter(p => p.status === "live").map(p => filter(p.id, p.name.replace("Tany ", "")))}
        </div>
        <p className="text-xs text-muted-foreground">{kinds.map(kind => `${tenants.filter(t => t.kind === kind).length} ${tenantKindLabel[kind].toLowerCase()}`).join(" · ")}</p>
      </div>
      {tenants.length
        ? <BusinessTable businesses={tenants} showKind actions={business => <ToggleActive businessId={business.id} active={business.active} name={business.name} />} />
        : <EmptyPanel title="No test or staging tenants" detail="Tenants whose id starts with test-, demo- or phase<N>-, or that are marked as test data, appear here." />}
      <p className="text-xs leading-5 text-muted-foreground">
        Classification uses a business&rsquo;s <code className="font-mono">tenantKind</code> setting when present, otherwise its tenant id prefix
        (<code className="font-mono">test-</code>, <code className="font-mono">demo-</code>, <code className="font-mono">phase&lt;N&gt;-</code>). Deactivating keeps all data; deleting isn&rsquo;t available here.
      </p>
    </div>
  );
}

export default function SystemPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><TestAndStaging {...props} /></Suspense>;
}
