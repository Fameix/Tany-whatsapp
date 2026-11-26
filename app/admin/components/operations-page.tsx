import { catalogSettingsData } from "@/lib/whatsapp/catalog";
import { getAvailableCatalogItems } from "@/lib/messaging/services/catalog-service";
import { WhatsAppCatalogSettings } from "./whatsapp-catalog-settings";
import { AutomationPage } from "./automations/automation-page";
import { getOperationsData } from "@/lib/admin/operations-service";
import type { OperationSection } from "@/lib/admin/operations-types";
import { OperationsPanel } from "./operations-panel";
import { PostgresDirectoryOverview } from "./postgres-directory-overview";
import { databaseMode } from "@/lib/data/repository";

export async function OperationsPage({
  businessId,
  section = "overview",
  clientFacing = false,
}: {
  businessId?: string;
  section?: OperationSection;
  clientFacing?: boolean;
}) {
  const postgresDirectory = ["dual-write", "postgres"].includes(databaseMode());
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
    </>
  );
}
