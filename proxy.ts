import { NextRequest, NextResponse } from "next/server";
import { signIntegrationAccess } from "@/lib/integration/access";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessSetupRouteBusinessId, resolveWhatsAppSetupAccess } from "@/lib/admin/whatsapp-setup-access";
import { productTestEntryMarker, productTestEntryPath, productTestStagingMode } from "@/lib/admin/product-test-tenants";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const localCookieOptions = { httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 7 * 24 * 60 * 60 };

/** Standalone internal console: client subscription/login policy belongs to the integration APIs. */
export async function proxy(request: NextRequest) {
  const entry = await productTestEntryRedirect(request);
  if (entry) return entry;
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  // Local-only convenience: issue the same signed directory credential the
  // handoff route issues. The secret never leaves this server-side boundary.
  if (process.env.NODE_ENV === "development" && localHosts.has(request.nextUrl.hostname)) {
    const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
    const token = request.cookies.get("tany-dashboard-dev")?.value ?? "";
    // Never replace a valid business session with the directory (Super Admin) credential;
    // only a missing or invalid dashboard cookie receives the local convenience session.
    const valid = !!token && !token.startsWith("otp_") && (await resolveDashboardSession(secret, token)) !== null;
    if (!valid && !token.startsWith("otp_") && secret.length >= 32) {
      const credential = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 7 * 24 * 60 * 60);
      response.cookies.set("tany-dashboard-dev", credential, localCookieOptions);
    }
  }
  return response;
}
/** Staging only: a visitor with no session on a test tenant's setup page is sent to that
 * tenant's entry link, which issues the scoped session. Existing sessions (including a
 * Super Admin or another tenant) are never redirected, so their rejections still apply. */
async function productTestEntryRedirect(request: NextRequest) {
  const { nextUrl } = request;
  if (nextUrl.searchParams.has(productTestEntryMarker)) return null;
  const businessId = businessSetupRouteBusinessId(nextUrl.pathname, nextUrl.origin);
  const entryPath = businessId ? productTestEntryPath(businessId) : null;
  if (!businessId || !entryPath || !productTestStagingMode()) return null;
  const access = await resolveWhatsAppSetupAccess(
    process.env.MESSAGING_SERVICE_SECRET ?? "",
    request.cookies.get(dashboardSessionCookieName)?.value ?? "",
    request.cookies.get(whatsappSetupSessionCookieName)?.value ?? "",
    businessId,
  );
  if (access.ok || access.reason !== "unauthenticated") return null;
  const response = NextResponse.redirect(new URL(entryPath, nextUrl.origin), 307);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/admin/:path*", "/business/:path*", "/dashboard/:path*"] };
