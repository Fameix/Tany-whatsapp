import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AutomationBuilder } from "@/app/admin/components/automations/automation-builder";
import { OperationsPanel } from "@/app/admin/components/operations-panel";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { LoadingPanel } from "@/app/admin/components/shared";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { BusinessTable, EmptyPanel, PageHeader, surface } from "@/app/admin/components/control-center/ui";
import { getOperationalOverview } from "@/lib/admin/operational-overview";
import { getProductOperationsData } from "@/lib/admin/operations-service";
import { productNavigation } from "@/lib/admin/product-navigation";
import { listProductRecords } from "@/lib/admin/product-records";
import { adminProductPath } from "@/lib/admin/product-routes";
import { listProductProfiles } from "@/lib/admin/product-scope";
import { productTestDataPreference } from "@/lib/admin/product-test-data";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { ProductWhatsApp } from "@/app/admin/components/control-center/product-whatsapp";

type Props = { params: Promise<{ product: string; section: string }>; searchParams: Promise<{ business?: string | string[]; setup?: string | string[] }> };

const descriptions = {
  orders: "Order records from this product’s businesses.",
  delivery: "Orders marked out for delivery or delivered.",
  "test-drives": "Test-drive bookings from this product’s dealers.",
  vehicles: "Vehicles listed in this product’s dealer catalogs.",
  products: "Items listed in this product’s store catalogs.",
};

async function ProductSectionPage({ params, searchParams }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product: id, section: slug } = await params;
  const product = tanyProducts.find(item => item.id === id);
  if (!product) notFound();
  const item = productNavigation(product).flatMap(group => group.links).find(link => link.section === slug);
  if (!item || item.section === "overview") notFound();
  const { section, label } = item;
  const root = adminProductPath(product.id);
  const workspaceHref = (businessId: string) => `/business/${encodeURIComponent(businessId)}`;
  const actionClass = "inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium text-primary hover:underline";

  if (!isActiveTanyVertical(product.id)) {
    return <div className="space-y-4">
      <PageHeader title="Settings" description={product.name} />
      <EmptyPanel title="Coming soon" detail="Settings will be available when this product launches." />
    </div>;
  }
  const { include: includeTestData, local } = await productTestDataPreference();
  if (section === "whatsapp") return <ProductWhatsApp product={product.id} query={await searchParams} includeTestData={includeTestData} local={local} />;

  if (section === "inbox" || section === "customers" || section === "templates" || section === "campaigns" ||
      section === "message-status" || section === "webhook-health") {
    return <OperationsPanel key={`${item.href}/${includeTestData}`} data={{ ...(await getProductOperationsData(product.id, includeTestData)), audience: "admin" }}
      section={section === "customers" ? "contacts" : section} adminRoot={root} localStaging={local} />;
  }

  if (section === "automations") {
    const businesses = (await listProductProfiles(product.id, includeTestData)).map(({ id, name }) => ({ id, name }));
    return <AutomationBuilder key={item.href} businesses={businesses} data={null} />;
  }

  if (section === "leads") {
    return <div className="space-y-4">
      <PageHeader title={label} description={product.name} />
      <EmptyPanel title="Lead tracking isn’t available yet" detail="Open the Inbox to review customer enquiries from this product’s businesses."
        action={<Link href={`${root}/inbox`} className={actionClass}>Open Inbox</Link>} />
    </div>;
  }

  if (section === "settings") {
    const businesses = await listProductProfiles(product.id, includeTestData);
    return <div className="space-y-4">
      <PageHeader title={label} description="Manage settings from each business workspace." />
      {businesses.length ? <ul className={`${surface} divide-y divide-border/60 px-4`}>
        {businesses.map(business => <li key={business.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 py-2">
          <span className="break-words text-sm font-medium">{business.name}</span>
          <Link href={`${workspaceHref(business.id)}/settings`} className={actionClass}>Open settings</Link>
        </li>)}
      </ul> : <EmptyPanel title="No business settings to manage" detail="A business workspace is required to manage settings." />}
    </div>;
  }

  if (section === "dealers" || section === "restaurants" || section === "stores") {
    const { directory } = await getOperationalOverview(product.id, { includeTestData });
    return <div className="space-y-4">
      <PageHeader title={label} description={`Business workspaces for ${product.name}.`} />
      {directory.length ? <BusinessTable businesses={directory} showProduct={false} openLabel="Open workspace" />
        : <EmptyPanel title="No businesses yet" detail="Business workspaces will appear here as they are added to this product." />}
    </div>;
  }

  const records = await listProductRecords(product.id, section, undefined, includeTestData);
  return <div className="space-y-4">
    <PageHeader title={label} description={descriptions[section]} />
    {records.length ? <ul className={`${surface} divide-y divide-border/60 px-4`}>
      {records.slice(0, 100).map(record => <li key={`${record.businessId}/${record.id}`} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 py-3">
        <div className="min-w-0 flex-1 basis-36">
          <p className="break-all text-sm font-medium">{record.name ?? record.id}</p>
          <p className="break-words text-xs text-muted-foreground">{record.business}</p>
        </div>
        {record.status && <span className="rounded-md bg-muted px-2 py-1 text-xs capitalize">{record.status.replaceAll("_", " ")}</span>}
        <Link href={workspaceHref(record.businessId)} className={actionClass}>Open business</Link>
      </li>)}
    </ul> : <EmptyPanel title="No records yet" detail={descriptions[section]} />}
    {records.length > 100 && <p className="text-xs text-muted-foreground">Showing the 100 most recently updated records.</p>}
  </div>;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductSectionPage {...props} /></Suspense>;
}
