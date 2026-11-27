import { requireDashboardAccess } from "@/lib/admin/dashboard-session";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperationsPage } from "@/app/admin/components/operations-page";
import { operationSections } from "@/lib/admin/operations-types";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { loadBusiness } from "@/app/business/_components/load-business";
import { RecordTable } from "@/app/business/_components/record-table";
import {
  listWorkspaceRecords,
  isWorkspaceCollection,
} from "@/lib/admin/workspace-service";
import { listCatalog } from "@/lib/admin/services";
import { CatalogPanel } from "@/app/admin/components/catalog-panel";
import { workspaceProductContext } from "@/app/business/_components/workspace-product-context";
import { matchesWorkspaceModule, workspaceProductModules } from "@/lib/admin/workspace-products";
import { isWorkspaceAlias, workspaceRoot } from "@/lib/admin/workspace-root";
import { RetailAdminLinks } from "@/app/business/_components/retail-admin-links";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { canViewBusiness } from "@/app/business/_components/business-access";

type SectionProps = {
  params: Promise<{ businessId: string; section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Section({ params, searchParams }: SectionProps) {
  await connection();
  const { businessId, section } = await params;
  const conversation = (await searchParams).conversation;
  if (operationSections.some((value) => value === section)) {
    if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
    await loadBusiness(businessId);
    return (<>
      <OperationsPage
        businessId={businessId}
        section={section as (typeof operationSections)[number]}
        clientFacing={false}
        conversationId={section === "inbox" && typeof conversation === "string" ? conversation : undefined}
      />
      {section === "settings" && (await isWorkspaceAlias()) && <RetailAdminLinks />}
    </>);
  }
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  const { business, product } = await workspaceProductContext(businessId);
  const tool = workspaceProductModules(product).find(item => item.section === section);
  if (!tool) {
    // Preserve the legacy admin catalog and record URLs. Client modules are granted above.
    if (section !== "catalog" && (!isWorkspaceCollection(section) || section === "orders")) notFound();
    await requireDashboardAccess();
  }

  const catalogType = section === "vehicles" ? "vehicle" : section === "products" || section === "menu" ? "product" : null;
  const title = tool?.label ?? section[0].toUpperCase() + section.slice(1);
  let content: React.ReactNode;
  if (catalogType || section === "catalog") {
    const items = await listCatalog(businessId);
    content = <CatalogPanel key={business.id + "/" + section} business={{ ...business, vertical: product ?? business.vertical, settings: {}, whatsappPhoneNumberId: "" }}
      items={catalogType ? items.filter(item => item.type === catalogType) : items} />;
  } else {
    const collection = section === "test-drives" ? "bookings" : section === "leads" ? "conversations" : section === "delivery" ? "orders" : section;
    if (!isWorkspaceCollection(collection)) notFound();
    const records = await listWorkspaceRecords(businessId, collection, tool ? data =>
      matchesWorkspaceModule(tool.section, product, business.vertical, data) : undefined);
    content = <RecordTable key={business.id + "/" + section} section={collection} label={title.toLowerCase()} records={records} />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {section === "leads" ? "Vehicle enquiries from your WhatsApp conversations." : business.name}
        </p>
        {section === "leads" && <Button asChild variant="outline" className="mt-3"><Link href={(await workspaceRoot(businessId)) + "/inbox"}>Open Inbox</Link></Button>}
      </div>
      {content}
    </div>
  );
}
export default function BusinessSection(props: SectionProps) {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Section {...props} />
    </Suspense>
  );
}
