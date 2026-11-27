import { NextRequest, NextResponse } from "next/server";
import { signIntegrationAccess } from "@/lib/integration/access";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessSetupRouteBusinessId, businessSetupRouteHeader, resolveWhatsAppSetupAccess } from "@/lib/admin/whatsapp-setup-access";
import { isProductTestBusiness, productTestEntryMarker, productTestEntryPath } from "@/lib/admin/product-test-tenants";
import { canIncludeStagingTestData, isLocalStaging } from "@/lib/admin/staging-environment";

const localCookieOptions = { httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 7 * 24 * 60 * 60 };

/** Standalone internal console: client subscription/login policy belongs to the integration APIs. */
export async function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const localStaging = isLocalStaging(hostname) && isLocalStaging(request.headers.get("host") ?? hostname);
  const [, area, businessId] = request.nextUrl.pathname.split("/");
  // The route trees own authorization. Only business routes use setup handoffs,
  // and /dashboard keeps its existing session or normal phone sign-in.
  const setupBusiness = area === "business"
    ? businessSetupRouteBusinessId(request.nextUrl.pathname, request.nextUrl.origin)
    : null;
  const entry = setupBusiness && !localStaging ? await productTestEntryRedirect(request) : null;
  if (entry) return entry;
  let credential: string | undefined;
  if (localStaging) {
    const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
    const token = request.cookies.get("tany-dashboard-dev")?.value ?? "";
    const valid = !!token && !token.startsWith("otp_") && (await resolveDashboardSession(secret, token)) !== null;
    const scope = area === "admin" ? { kind: "directory" as const }
      : area === "business" && isProductTestBusiness(businessId) ? { kind: "business" as const, businessId } : null;
    if (scope && !valid && !token.startsWith("otp_") && secret.length >= 32) {
      credential = await signIntegrationAccess(secret, scope, Date.now(), "tany-dashboard-v1", localCookieOptions.maxAge);
      request.cookies.set("tany-dashboard-dev", credential);
    }
  }
  const requestHeaders = new Headers(request.headers);
  // Never trust a client-supplied marker. Only the canonical setup path can use a setup-only cookie in its layout.
  requestHeaders.delete(businessSetupRouteHeader);
  if (setupBusiness) requestHeaders.set(businessSetupRouteHeader, encodeURIComponent(setupBusiness));
  const response = credential || setupBusiness || request.headers.has(businessSetupRouteHeader)
    ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next();
  if (credential) response.cookies.set("tany-dashboard-dev", credential, localCookieOptions);
  response.headers.set("Cache-Control", "private, no-store");
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
  if (!businessId || !entryPath || !canIncludeStagingTestData(nextUrl.hostname)) return null;
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
