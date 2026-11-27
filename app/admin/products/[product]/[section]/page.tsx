import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { LoadingPanel } from "@/app/admin/components/shared";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { EmptyPanel, PageHeader } from "@/app/admin/components/control-center/ui";
import { productNavigation } from "@/lib/admin/product-navigation";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";

type Props = { params: Promise<{ product: string; section: string }> };

/** A coming-soon product's sections. A live product's pages are its workspace
 * (lib/admin/product-workspace), served by the proxy; the old product pages are retired. */
async function ProductSectionPage({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id, section: slug } = await params;
  const product = tanyProducts.find(item => item.id === id);
  if (!product || isActiveTanyVertical(product.id)) notFound();
  const item = productNavigation(product).flatMap(group => group.links).find(link => link.section === slug);
  if (!item || item.section !== "settings") notFound();
  return <div className="space-y-4">
    <PageHeader title={item.label} description={product.name} />
    <EmptyPanel title="Coming soon" detail="Settings will be available when this product launches." />
  </div>;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductSectionPage {...props} /></Suspense>;
}
