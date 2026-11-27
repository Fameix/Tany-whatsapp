import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { verifyIntegrationAccess } from "@/lib/integration/access";
import { dashboardSessionCookieName } from "./dashboard-cookie";
import { DashboardAuthorizationError } from "./dashboard-session";

/** Super Admin uses only the signed gateway directory assertion. */
export const isSuperAdmin = cache(async () => {
  const token = (await cookies()).get(dashboardSessionCookieName)?.value ?? "";
  return verifyIntegrationAccess(
    process.env.MESSAGING_SERVICE_SECRET ?? "",
    token,
    { kind: "directory" },
    Date.now(),
    "tany-dashboard-v1",
  );
});

export async function requireSuperAdmin() {
  if (!(await isSuperAdmin())) throw new DashboardAuthorizationError("Super Admin access required.", 403);
}
