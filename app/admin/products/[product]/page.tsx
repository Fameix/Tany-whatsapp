import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { BusinessTable, EmptyPanel, HiddenTenantsNote, ProductStatus, StatTile, healthLabel, isSuperAdmin } from "@/app/admin/components/control-center/ui";
import { listProductBusinesses, messagingHealth, realBusinesses, totalsFor } from "@/lib/admin/product-center";
import { tanyProducts } from "@/lib/messaging/vertical-config";

type Props = { params: Promise<{ product: string }> };

/** One product: metrics and businesses scoped to that product's real businesses only. */
async function ProductDetail({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <DashboardAccessRequired />;
  const { product: id } = await params;
  const product = tanyProducts.find(candidate => candidate.id === id);
  if (!product) notFound();
  const all = (await listProductBusinesses()).filter(business => business.product === product.id);
  const businesses = realBusinesses(all);
  const totals = totalsFor(businesses);
  const health = messagingHealth(totals);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <div className="pt-2">
        <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />Products</Link>
        <div className="flex flex-wrap items-center gap-3">
          <BrandLogo vertical={product.id} decorative />
          <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
          <ProductStatus status={product.status} />
        </div>
      </div>
      {product.status !== "live" ? (
        <EmptyPanel title={`${product.name} is coming soon`} detail="This product isn't available to businesses yet, so it has no businesses, conversations or messaging activity." />
      ) : (
        <>
          <section aria-label={`${product.name} metrics`} className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile label="Businesses" value={totals.businesses} />
            <StatTile label="Connected WhatsApp" value={totals.connected} />
            <StatTile label="Conversations" value={totals.conversations} detail={`${totals.conversationsToday} today`} />
            <StatTile label="Customers" value={totals.customers} />
            <StatTile label="Active automations" value={totals.activeAutomations} />
            <StatTile label="Campaigns" value={totals.campaigns} />
            <StatTile label="Templates" value={totals.templates} detail={`${totals.approvedTemplates} approved`} />
            <StatTile label="Messaging health" value={<span className={`text-base ${healthLabel[health].className}`}>{healthLabel[health].label}</span>} detail={`${totals.incoming24h} in · ${totals.outgoing24h} out · ${totals.failed24h} failed (24h)`} />
          </section>
          <section aria-labelledby="product-businesses" className="flex flex-col gap-3">
            <h2 id="product-businesses" className="text-sm font-semibold tracking-tight">Businesses</h2>
            {businesses.length
              ? <BusinessTable businesses={businesses} />
              : <EmptyPanel title={`No ${product.name} businesses yet`} detail="Businesses appear here once they're created for this product." action={<Link href="/admin/businesses/new" className="mt-2 text-xs font-medium text-primary hover:underline">Add a business</Link>} />}
            <HiddenTenantsNote count={all.length - businesses.length} href={`/admin/system?product=${product.id}`} />
          </section>
        </>
      )}
    </div>
  );
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductDetail {...props} /></Suspense>;
}
