import "server-only";
import { DashboardAuthorizationError, requireDashboardAccess } from "@/lib/admin/dashboard-session";

/** Page-level tenant check. The business layout already hides unauthorized pages, but a
 * page renders in parallel with its layout, so a page that loads tenant data must check
 * access itself before reading anything. */
export async function canViewBusiness(businessId: string) {
  try {
    await requireDashboardAccess(businessId);
    return true;
  } catch (error) {
    if (error instanceof DashboardAuthorizationError) return false;
    throw error;
  }
}
