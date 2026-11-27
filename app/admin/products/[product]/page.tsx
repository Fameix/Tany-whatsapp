import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { LoadingPanel } from "@/app/admin/components/shared";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { BusinessTable, EmptyPanel, ProductStatus } from "@/app/admin/components/control-center/ui";
import {
  BusinessAttention, MessagingHealth, OperationalMetrics,
} from "@/app/admin/components/control-center/operational-dashboard";
import { getOperationalOverview } from "@/lib/admin/operational-overview";
import { adminProductPath } from "@/lib/admin/product-routes";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { productTestDataPreference } from "@/lib/admin/product-test-data";

type Props = { params: Promise<{ product: string }> };

const directories = {
  motos: { title: "Dealer businesses", section: "dealers" },
  eats: { title: "Restaurant businesses", section: "restaurants" },
  retail: { title: "Retail businesses", section: "stores" },
};

/** A product's dashboard, in the same simple layout as a business's Home. */
async function ProductDetail({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id } = await params;
  const product = tanyProducts.find(candidate => candidate.id === id);
  // Tany Retail's dashboard is its workspace (lib/admin/retail-workspace); the old overview is retired.
  if (!product || product.id === "retail") notFound();

  const liveProduct = isActiveTanyVertical(product.id) ? product.id : null;
  const directory = liveProduct ? directories[liveProduct] : null;
  const includeTestData = liveProduct ? (await productTestDataPreference()).include : false;
  const data = liveProduct ? await getOperationalOverview(liveProduct, { includeTestData }) : null;
  const root = adminProductPath(product.id);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 pb-8">
      <header className="flex flex-col gap-4 pt-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <BrandLogo vertical={product.id} decorative className="size-12 sm:size-14" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{product.name}</h1>
              <ProductStatus status={product.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{liveProduct ? "Businesses, WhatsApp connections and messaging for this product." : "This product isn't available to businesses yet."}</p>
          </div>
        </div>
        {liveProduct && directory && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`${root}/${directory.section}`}>All businesses</Link></Button>
            <Button asChild size="sm"><Link href={`${root}/whatsapp`}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</Link></Button>
          </div>
        )}
      </header>
      {!liveProduct && <EmptyPanel title={`${product.name} is coming soon`} detail="It has no businesses or messaging activity yet." />}
      {data && directory && (
        <>
          <OperationalMetrics data={{ ...data.metrics, businesses: data.directory.length }} product />
          <div className="grid min-w-0 gap-6 lg:grid-cols-3">
            <section aria-labelledby="product-businesses" className="flex min-w-0 flex-col gap-3 lg:col-span-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="product-businesses" className="text-sm font-semibold tracking-tight">{directory.title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{data.directory.length}</span>
              </div>
              {data.directory.length
                ? <BusinessTable businesses={data.directory} showProduct={false} openLabel="Open workspace" primaryWorkspace layout="list" />
                : <EmptyPanel title={`No ${includeTestData ? "" : "live "}${product.name} businesses yet`} detail="Business workspaces appear here as they're added to this product." />}
            </section>
            <div className="flex min-w-0 flex-col gap-6">
              <MessagingHealth data={data.health} />
              <BusinessAttention items={data.attention} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductDetail {...props} /></Suspense>;
}
