import { catalogSettingsData } from "@/lib/whatsapp/catalog";
import { getAvailableCatalogItems } from "@/lib/messaging/services/catalog-service";
import { WhatsAppCatalogSettings } from "./whatsapp-catalog-settings";
import { AutomationPage } from "./automations/automation-page";
import { getOperationsData } from "@/lib/admin/operations-service";
import type { OperationSection } from "@/lib/admin/operations-types";
import { OperationsPanel } from "./operations-panel";
import { PostgresDirectoryOverview } from "./postgres-directory-overview";
import { databaseMode } from "@/lib/data/repository";
import { BusinessWhatsApp } from "@/app/business/_components/business-whatsapp";
import { WhatsAppDiagnostics, WhatsAppProfileLink } from "@/app/business/_components/whatsapp-diagnostics";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { isWorkspaceAlias, workspaceDisplayName } from "@/lib/admin/workspace-root";
import { loadBusiness } from "@/app/business/_components/load-business";

/** One business's operations data, labelled with the name its workspace shows (Tany Retail
 * inside Super Admin). Every row already belongs to that business. */
async function workspaceOperationsData(businessId?: string) {
  const data = await getOperationsData(businessId);
  if (!businessId || !(await isWorkspaceAlias())) return data;
  const name = await workspaceDisplayName(await loadBusiness(businessId));
  const relabel = <T extends { business: string }>(rows: T[]) => rows.map(row => ({ ...row, business: name }));
  return {
    ...data, businessName: name, messages: relabel(data.messages), conversations: relabel(data.conversations), contacts: relabel(data.contacts),
    templates: relabel(data.templates), campaigns: relabel(data.campaigns), accounts: relabel(data.accounts),
  };
}

export async function OperationsPage({
  businessId,
  section = "overview",
  clientFacing = false,
  conversationId,
}: {
  businessId?: string;
  section?: OperationSection;
  clientFacing?: boolean;
  conversationId?: string;
}) {
  const postgresDirectory = ["dual-write", "postgres"].includes(databaseMode());
  // A business never sees the cross-tenant directory; its account page is scoped to it alone.
  if (postgresDirectory && businessId && section === "whatsapp-accounts")
    return <BusinessWhatsApp businessId={businessId} detailed={!clientFacing} />;
  if (postgresDirectory && (section === "overview" || section === "whatsapp-accounts"))
    return <PostgresDirectoryOverview businessId={businessId} accountsOnly={section === "whatsapp-accounts"} showConnectionCta={clientFacing && section === "whatsapp-accounts"} />;
  if (section === "automations")
    return <AutomationPage businessId={businessId} />;
  return (
    <>
      <OperationsPanel
        key={`${businessId ?? "admin"}/${section}`}
        data={{ ...(await workspaceOperationsData(businessId)), audience: "admin" }}
        section={section}
        localStaging={await localStagingWorkspace()}
        initialConversationId={conversationId}
      />
      {section === "settings" && businessId && (
        <WhatsAppCatalogSettings
          businessId={businessId}
          config={await catalogSettingsData(businessId)}
          products={(await getAvailableCatalogItems(businessId))
            .filter((p) => p.type === "product")
            .map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
      {section === "settings" && businessId && (
        <div className="mt-8 flex flex-col gap-6">
          <section aria-labelledby="whatsapp-settings" className="flex flex-col gap-2">
            <h2 id="whatsapp-settings" className="text-sm font-semibold tracking-tight">WhatsApp</h2>
            <WhatsAppProfileLink businessId={businessId} />
          </section>
          <WhatsAppDiagnostics businessId={businessId} />
        </div>
      )}
    </>
  );
}
