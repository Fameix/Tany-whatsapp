import { verifyIntegrationAccess } from "@/lib/integration/access";
import { verifyDirectorySession } from "./directory-session";

export type DashboardSession = { role: "admin" } | { role: "business"; businessId: string } | { role: "selector"; businessIds: string[] };
/** Decode only to identify the candidate scope, then authenticate that exact scope. */
export async function resolveDashboardSession(secret: string, token: string, requestHost?: string): Promise<DashboardSession | null> {
  try {
    if (token.length > 4096) return null;
    if (token.startsWith("otp_")) {
      const { resolvePhoneLoginSession } = await import("@/lib/admin/phone-login-service");
      return await resolvePhoneLoginSession(token);
    }
    const payload = token.split(".")[0];
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
    if (claims.scope?.kind === "directory" && await verifyDirectorySession(secret, token, requestHost)) return { role: "admin" };
    const businessId = claims.scope?.businessId;
    if (claims.scope?.kind === "business" && typeof businessId === "string" && businessId.trim() && !businessId.includes("/") && businessId.length <= 1500 &&
      await verifyIntegrationAccess(secret, token, { kind: "business", businessId }, Date.now(), "tany-dashboard-v1")) return { role: "business", businessId };
  } catch { /* Invalid or untrusted claims never establish a session. */ }
  return null;
}

/** Separate audience: directory API read credentials cannot become dashboard administrator credentials. */
export async function dashboardAccess(
  secret: string,
  token: string,
  businessId?: string,
): Promise<"admin" | "business" | null> {
  if (await verifyDirectorySession(secret, token)) return "admin";
  if (
    businessId &&
    (await verifyIntegrationAccess(
      secret,
      token,
      { kind: "business", businessId },
      Date.now(),
      "tany-dashboard-v1",
    ))
  )
    return "business";
  return null;
}
