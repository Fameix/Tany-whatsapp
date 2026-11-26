import "server-only";
import { cookies } from "next/headers";
import type { DashboardSession } from "@/lib/admin/dashboard-access";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";

export class DashboardAuthorizationError extends Error {
  constructor(message = "Dashboard authentication required", public status = 401) {
    super(message);
  }
}

/** Resolve the same signed, scoped dashboard session used by the client portal. */
export async function getDashboardSession(): Promise<DashboardSession> {
  const store = await cookies();
  const session = await resolveDashboardSession(
    process.env.MESSAGING_SERVICE_SECRET ?? "",
    store.get(dashboardSessionCookieName)?.value ?? "",
  );
  if (!session) throw new DashboardAuthorizationError();
  return session;
}

export async function dashboardBusinessId(requested?: string) {
  const session = await getDashboardSession();
  if (session.role === "business") {
    if (requested && requested !== session.businessId)
      throw new DashboardAuthorizationError("Business access denied", 403);
    return session.businessId;
  }
  if (session.role === "selector")
    throw new DashboardAuthorizationError("Choose a business", 400);
  if (!requested) throw new DashboardAuthorizationError("Select a business", 400);
  return requested;
}

export async function requireDashboardAccess(businessId?: string) {
  const session = await getDashboardSession();
  if (session.role === "admin") return "admin" as const;
  if (session.role === "selector")
    throw new DashboardAuthorizationError("Choose a business", 400);
  if (businessId !== session.businessId)
    throw new DashboardAuthorizationError("Dashboard authorization required", 403);
  return "business" as const;
}
