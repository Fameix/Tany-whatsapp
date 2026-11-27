import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { verifyWhatsAppSetupSession } from "@/lib/admin/whatsapp-setup-session";
import { businessWorkspacePath } from "./workspace-path";

export type WhatsAppSetupAccess =
  | { ok: true; via: "business-session" | "setup-session" }
  | { ok: false; reason: "wrong-business" | "admin-requires-handoff" | "unauthenticated" };

/** Resolves access to `/business/{businessId}/whatsapp/setup` from the route plus an
 * authorized business credential. A Super Admin dashboard session alone never grants
 * setup and is never converted into a business session: it must go through the
 * explicit business-scoped handoff, which issues a separate setup-session cookie. */
export async function resolveWhatsAppSetupAccess(
  secret: string,
  dashboardToken: string,
  setupToken: string,
  businessId: string,
): Promise<WhatsAppSetupAccess> {
  const session = await resolveDashboardSession(secret, dashboardToken);
  if (session?.role === "business")
    return session.businessId === businessId ? { ok: true, via: "business-session" } : { ok: false, reason: "wrong-business" };
  if (setupToken && await verifyWhatsAppSetupSession(secret, setupToken, businessId)) return { ok: true, via: "setup-session" };
  if (session?.role === "admin") return { ok: false, reason: "admin-requires-handoff" };
  return { ok: false, reason: "unauthenticated" };
}

export const businessWhatsAppSetupPath = (businessId: string) => `${businessWorkspacePath(businessId)}/whatsapp/setup`;
export const businessWhatsAppDashboardPath = (businessId: string) => `${businessWorkspacePath(businessId)}/whatsapp`;
export const businessSetupRouteHeader = "x-tany-business-setup-route";

/** Parses a handoff `next` value that targets the business-scoped setup route. */
export function businessSetupRouteBusinessId(value: string | null, origin: string) {
  if (!value) return null;
  try {
    const next = new URL(value, origin);
    const match = /^\/business\/([^/]+)\/whatsapp\/setup$/.exec(next.pathname);
    if (next.origin !== origin || !match || next.search || next.hash) return null;
    const businessId = decodeURIComponent(match[1]);
    return businessId && businessId.length <= 1500 && !businessId.includes("/") ? businessId : null;
  } catch { return null; }
}
