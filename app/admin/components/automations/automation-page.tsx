import { listBusinessProfiles } from "@/lib/admin/services";
import { automationDashboard } from "@/lib/automations/service";
import { EntitlementError } from "@/lib/subscriptions/entitlements";
import { AutomationBuilder } from "./automation-builder";
import { refreshPendingTemplates } from "@/lib/templates/meta-templates";
import { listBusinessTemplates } from "@/lib/templates/repository";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";

/** Same best-effort refresh the Templates page uses, so a template Meta has just approved
 * is selectable here without a visit to Templates. Failures leave the stored status. */
async function refreshTemplateStatuses(businessId: string) {
  try { await refreshPendingTemplates(businessId, await listBusinessTemplates(businessId)); }
  catch { /* Status refresh is optional; the stored status stays authoritative. */ }
}
export async function AutomationPage({ businessId }: { businessId?: string }) {
  if (process.env.NODE_ENV === "development")
    console.info("[AUTOMATION_PAGE_START]", { businessId: businessId ?? null });
  let businesses: Awaited<ReturnType<typeof listBusinessProfiles>> = [];
  let data: Awaited<ReturnType<typeof automationDashboard>> | null = null;
  try {
    if (!businessId) {
      if (process.env.NODE_ENV === "development")
        console.info("[AUTOMATION_PAGE_BUSINESSES_START]", {});
      businesses = await listBusinessProfiles();
      if (process.env.NODE_ENV === "development")
        console.info("[AUTOMATION_PAGE_BUSINESSES_DONE]", {
          count: businesses.length,
        });
    }
    if (businessId) {
      if (process.env.NODE_ENV === "development")
        console.info("[AUTOMATION_PAGE_DASHBOARD_START]", { businessId });
      if (!(await localStagingWorkspace())) await refreshTemplateStatuses(businessId);
      data = await automationDashboard(businessId);
      if (process.env.NODE_ENV === "development")
        console.info("[AUTOMATION_PAGE_DASHBOARD_DONE]", { businessId });
    }
  } catch (error) {
    if (error instanceof EntitlementError)
      return <main className="rounded-xl border p-6"><p className="text-sm font-medium text-primary">WhatsApp Automation</p><h1 className="mt-2 text-2xl font-semibold">Available with Pro</h1><p className="mt-3 text-sm text-muted-foreground">Upgrade this business plan to manage WhatsApp automations.</p></main>;
    if (process.env.NODE_ENV === "development") {
      const details = error as Error & { code?: unknown };
      console.error("[AUTOMATION_PAGE_FAILED]", {
        businessId: businessId ?? null,
        name: details.name,
        code: details.code,
        message: details.message,
        stack: details.stack,
      });
    }
    throw error;
  }
  return (
    <AutomationBuilder
      key={businessId ?? "all"}
      businessId={businessId}
      businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
      data={data}
    />
  );
}
