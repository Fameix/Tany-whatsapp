import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { verifyDirectorySession } from "./directory-session";
import { dashboardSessionCookieName } from "./dashboard-cookie";
import { DashboardAuthorizationError } from "./dashboard-session";

/** Super Admin uses a verified directory session. */
export const isSuperAdmin = cache(async () => {
  const token = (await cookies()).get(dashboardSessionCookieName)?.value ?? "";
  return verifyDirectorySession(process.env.MESSAGING_SERVICE_SECRET ?? "", token);
});

export async function requireSuperAdmin() {
  if (!(await isSuperAdmin())) throw new DashboardAuthorizationError("Super Admin access required.", 403);
}
