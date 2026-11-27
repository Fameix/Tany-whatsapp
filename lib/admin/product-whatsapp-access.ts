import "server-only";
import { DashboardAuthorizationError, requireDashboardAccess } from "./dashboard-session";
import { listProductProfiles } from "./product-scope";
import { productTestDataPreference } from "./product-test-data";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";

export async function requireProductWhatsAppBusiness(product: string, businessId: string, mutate = false) {
  if (await requireDashboardAccess() !== "admin") throw new DashboardAuthorizationError("Super Admin access required.", 403);
  if (!isActiveTanyVertical(product) || !businessId) throw new DashboardAuthorizationError("Business unavailable for this product.", 404);
  const { include, local } = await productTestDataPreference();
  const business = (await listProductProfiles(product, include)).find(item => item.id === businessId);
  if (!business) throw new DashboardAuthorizationError("Business unavailable for this product.", 404);
  if (mutate && !business.active) throw new DashboardAuthorizationError("This business is inactive.", 403);
  if (mutate && local) throw new DashboardAuthorizationError("Open the staging workspace for live WhatsApp management.", 403);
  if (mutate && !["postgres", "dual-write"].includes(process.env.MESSAGING_DATABASE ?? "")) {
    throw new DashboardAuthorizationError("WhatsApp management is unavailable in this environment.", 503);
  }
  return { business, local };
}
