import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { LoadingPanel } from "@/app/admin/components/shared";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { BusinessTable, EmptyPanel, ProductStatus, surface } from "@/app/admin/components/control-center/ui";
import {
  BusinessAttention, MessagingHealth, OperationalMetrics,
} from "@/app/admin/components/control-center/operational-dashboard";
import { getOperationalOverview } from "@/lib/admin/operational-overview";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { productTestDataPreference } from "@/lib/admin/product-test-data";

type Props = { params: Promise<{ product: string }> };

const directories = {
  motos: "Dealer businesses",
  eats: "Restaurant businesses",
  retail: "Retail businesses",
};

async function ProductDetail({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id } = await params;
  const product = tanyProducts.find(candidate => candidate.id === id);
  if (!product) notFound();

  const liveProduct = isActiveTanyVertical(product.id) ? product.id : null;
  const directory = liveProduct ? directories[liveProduct] : null;
  const includeTestData = liveProduct ? (await productTestDataPreference()).include : false;
  const data = liveProduct ? await getOperationalOverview(liveProduct, { includeTestData }) : null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 pb-6">
      <header className={surface + " p-4 sm:p-5"}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <BrandLogo vertical={product.id} decorative className="size-12 sm:size-14" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
              <ProductStatus status={product.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{liveProduct ? "Monitor business workspaces and WhatsApp connection health." : "This product is not live yet."}</p>
          </div>
        </div>
      </header>
      {data && directory && (
        <>
          <section aria-labelledby="product-businesses" className="min-w-0 space-y-3">
            <h2 id="product-businesses" className="text-sm font-semibold tracking-tight">{directory}</h2>
            {data.directory.length
              ? <BusinessTable businesses={data.directory} showProduct={false} openLabel="Open workspace" primaryWorkspace />
              : <EmptyPanel title={`No ${includeTestData ? "" : "live "}${product.name} businesses yet`} detail="Business workspaces will appear here as they are added to this product." />}
          </section>
          <OperationalMetrics data={{ ...data.metrics, businesses: data.directory.length }} product />
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <MessagingHealth data={data.health} />
            <BusinessAttention items={data.attention} />
          </div>
        </>
      )}
    </div>
  );
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductDetail {...props} /></Suspense>;
}
