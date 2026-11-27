import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { OperationsPanel } from "@/app/admin/components/operations-panel";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { LoadingPanel } from "@/app/admin/components/shared";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { BusinessTable, EmptyPanel, PageHeader } from "@/app/admin/components/control-center/ui";
import { getOperationalOverview } from "@/lib/admin/operational-overview";
import { getProductOperationsData } from "@/lib/admin/operations-service";
import { productNavigation, productWorkspaceRedirect } from "@/lib/admin/product-navigation";
import { adminProductPath } from "@/lib/admin/product-routes";
import { productTestDataPreference } from "@/lib/admin/product-test-data";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { ProductWhatsApp } from "@/app/admin/components/control-center/product-whatsapp";

type Props = { params: Promise<{ product: string; section: string }>; searchParams: Promise<{ business?: string | string[]; setup?: string | string[] }> };

async function ProductSectionPage({ params, searchParams }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id, section: slug } = await params;
  const product = tanyProducts.find(item => item.id === id);
  if (!product) notFound();
  const live = isActiveTanyVertical(product.id) ? product.id : null;
  const workspaceRedirect = live && productWorkspaceRedirect(live, slug);
  if (workspaceRedirect) redirect(workspaceRedirect);
  const item = productNavigation(product).flatMap(group => group.links).find(link => link.section === slug);
  if (!item || item.section === "overview" || item.section === "staging") notFound();
  const { section, label } = item;
  const root = adminProductPath(product.id);

  if (section === "settings") {
    return <div className="space-y-4">
      <PageHeader title={label} description={product.name} />
      {live ? <EmptyPanel title="Product administration" detail="Use system settings for shared configuration or open a business workspace to manage its settings."
        action={<div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href="/admin/settings">System settings</Link></Button>
          <Button asChild variant="outline"><Link href={root + "#product-businesses"}>Business workspaces</Link></Button>
        </div>} /> : <EmptyPanel title="Coming soon" detail="Settings will be available when this product launches." />}
    </div>;
  }
  if (!live) notFound();

  const { include: includeTestData, local } = await productTestDataPreference();
  if (section === "whatsapp") return <ProductWhatsApp product={live} query={await searchParams} includeTestData={includeTestData} local={local} />;

  if (section === "message-status" || section === "webhook-health") {
    return <OperationsPanel key={item.href} data={{ ...(await getProductOperationsData(live, includeTestData)), audience: "admin" }}
      section={section} adminRoot={root} localStaging={local} />;
  }

  const { directory } = await getOperationalOverview(live, { includeTestData });
  return <div className="space-y-4">
    <PageHeader title={label} description={`Business workspaces for ${product.name}.`} />
    {directory.length ? <BusinessTable businesses={directory} showProduct={false} openLabel="Open workspace" primaryWorkspace />
      : <EmptyPanel title="No businesses yet" detail="Business workspaces will appear here as they are added to this product." />}
  </div>;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductSectionPage {...props} /></Suspense>;
}
