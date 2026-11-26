import { NextRequest, NextResponse } from "next/server";
import { consumeDashboardHandoff } from "@/lib/admin/workspace-handoff";
import { signIntegrationAccess } from "@/lib/integration/access";
import { EntitlementError } from "@/lib/subscriptions/entitlements";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "@/lib/admin/dashboard-cookie";
import { signWhatsAppSetupSession, whatsappSetupSessionCookieName, whatsappSetupSessionCookieOptions } from "@/lib/admin/whatsapp-setup-session";
import { businessSetupRouteBusinessId, businessWhatsAppSetupPath } from "@/lib/admin/whatsapp-setup-access";

function requestedSetupBusinessId(value: string | null, origin: string) {
  if (!value) return null;
  try {
    const next = new URL(value, origin);
    if (next.origin !== origin || next.pathname !== "/dashboard/messaging/setup" || next.hash || [...next.searchParams.keys()].length !== 1) return null;
    const businessId = next.searchParams.get("businessId");
    return businessId && businessId.length <= 1500 && !businessId.includes("/") ? businessId : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  try {
    const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
    if (secret.length < 32) return NextResponse.json({ message: "Workspace access is not configured." }, { status: 503, headers });
    const scope = await consumeDashboardHandoff(request.nextUrl.searchParams.get("token") ?? "");
    const requestedNext = request.nextUrl.searchParams.get("next");
    const scopedSetupBusinessId = businessSetupRouteBusinessId(requestedNext, request.nextUrl.origin);
    if (requestedNext && /^\/business\/[^/]+\/whatsapp\/setup/.test(requestedNext) && (!scopedSetupBusinessId || scope.kind !== "business" || scope.businessId !== scopedSetupBusinessId))
      return NextResponse.json({ message: "This setup link does not match the selected business." }, { status: 403, headers });
    if (scopedSetupBusinessId && scope.kind === "business" && scope.businessId === scopedSetupBusinessId) {
      // Business-scoped setup: issue only the short-lived setup session for this
      // business. Any Super Admin or business dashboard session is left untouched.
      const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: businessWhatsAppSetupPath(scopedSetupBusinessId) } });
      response.cookies.set(whatsappSetupSessionCookieName, await signWhatsAppSetupSession(secret, scopedSetupBusinessId), whatsappSetupSessionCookieOptions);
      return response;
    }
    const setupBusinessId = requestedSetupBusinessId(requestedNext, request.nextUrl.origin);
    if (requestedNext?.startsWith("/dashboard/messaging/setup?") && (!setupBusinessId || scope.kind !== "business" || scope.businessId !== setupBusinessId))
      return NextResponse.json({ message: "This setup link does not match the selected business." }, { status: 403, headers });
    if (setupBusinessId && scope.kind === "business" && scope.businessId === setupBusinessId) {
      const setupCredential = await signWhatsAppSetupSession(secret, setupBusinessId);
      const location = `/dashboard/messaging/setup?businessId=${encodeURIComponent(setupBusinessId)}`;
      const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });
      // Keep any Super Admin dashboard session intact. This cookie grants only
      // short-lived access to the selected business's WhatsApp setup flow.
      response.cookies.set(whatsappSetupSessionCookieName, setupCredential, whatsappSetupSessionCookieOptions);
      return response;
    }
    const credential = await signIntegrationAccess(secret, scope, Date.now(), "tany-dashboard-v1", 3600);
    // A relative Location retains the user's public service origin behind Cloud Run.
    const safeBusinessNext = requestedNext === "/dashboard/messaging/setup" ? requestedNext : null;
    const location = scope.kind === "directory" ? "/admin" : safeBusinessNext ?? `/business/${encodeURIComponent(scope.businessId)}`;
    const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });
    response.cookies.set(dashboardSessionCookieName, credential, dashboardSessionCookieOptions);
    return response;
  } catch (error) {
    return NextResponse.json(error instanceof EntitlementError ? error.details : { message: "This workspace link is invalid or expired. Open WhatsApp again from Tany." }, { status: error instanceof EntitlementError ? 403 : 400, headers });
  }
}
