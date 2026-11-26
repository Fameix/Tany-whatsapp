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
import { WhatsAppDiagnostics } from "@/app/business/_components/whatsapp-diagnostics";

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
        data={{ ...(await getOperationsData(businessId)), audience: "admin" }}
        section={section}
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
      {section === "settings" && businessId && <div className="mt-8"><WhatsAppDiagnostics businessId={businessId} /></div>}
    </>
  );
}
