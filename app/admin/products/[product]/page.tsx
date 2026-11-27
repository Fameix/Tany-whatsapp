import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { LoadingPanel } from "@/app/admin/components/shared";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { EmptyPanel, ProductStatus } from "@/app/admin/components/control-center/ui";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";

type Props = { params: Promise<{ product: string }> };

/** A coming-soon product's page. A live product's page is its workspace (lib/admin/product-workspace),
 * served by the proxy; the old product dashboards are retired. */
async function ProductDetail({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id } = await params;
  const product = tanyProducts.find(candidate => candidate.id === id);
  if (!product || isActiveTanyVertical(product.id)) notFound();

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 pb-8">
      <header className="flex min-w-0 items-center gap-4 pt-2">
        <BrandLogo vertical={product.id} decorative className="size-12 sm:size-14" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{product.name}</h1>
            <ProductStatus status={product.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">This product isn&apos;t available to businesses yet.</p>
        </div>
      </header>
      <EmptyPanel title={`${product.name} is coming soon`} detail="Its workspace (Home, Inbox, Customers, Automations, Campaigns, Templates, WhatsApp and Settings) opens here when it launches." />
    </div>
  );
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductDetail {...props} /></Suspense>;
}
