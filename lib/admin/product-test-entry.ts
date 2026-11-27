import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPostgresBusinessProfile } from "@/lib/admin/postgres-directory";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "@/lib/admin/dashboard-cookie";
import { signWhatsAppSetupSession, whatsappSetupSessionCookieName, whatsappSetupSessionCookieOptions } from "@/lib/admin/whatsapp-setup-session";
import { signIntegrationAccess } from "@/lib/integration/access";
import { isProductTestBusiness, productTestEntryMarker, productTestTenants, type ProductTestProduct } from "@/lib/admin/product-test-tenants";
import { canIncludeStagingTestData } from "@/lib/admin/staging-environment";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { businessWhatsAppDashboardPath, businessWhatsAppSetupPath } from "@/lib/admin/whatsapp-setup-access";

export { isProductTestBusiness, productTestTenants, type ProductTestProduct } from "@/lib/admin/product-test-tenants";

/** Public entry points intentionally grant access only to one fixed staging tenant. */
export async function productTestEntryResponse(request: NextRequest, product: ProductTestProduct) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  if (!canIncludeStagingTestData(request.nextUrl.hostname)) return NextResponse.json({ message: "Product test workspaces are unavailable." }, { status: 404, headers });
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  if (secret.length < 32) return NextResponse.json({ message: "Product test workspaces are not configured." }, { status: 503, headers });

  const target = productTestTenants[product];
  const business = await getPostgresBusinessProfile(target.businessId);
  if (!business || !business.active || business.vertical !== target.vertical)
    return NextResponse.json({ message: "Product test workspace is unavailable." }, { status: 404, headers });

  const currentToken = request.cookies.get(dashboardSessionCookieName)?.value ?? "";
  const currentSession = await resolveDashboardSession(secret, currentToken);
  if (currentSession?.role === "business" && currentSession.businessId !== target.businessId && !isProductTestBusiness(currentSession.businessId))
    return NextResponse.json({ message: "Open this product test link from a separate signed-in workspace." }, { status: 403, headers });
  if (currentSession?.role === "selector")
    return NextResponse.json({ message: "Choose a product test link in a separate browser session." }, { status: 403, headers });

  const connection = await getClientWhatsAppConnection(target.businessId);
  const connected = connection.status === "connected" && connection.health === "verified";
  const location = connected ? businessWhatsAppDashboardPath(target.businessId) : `${businessWhatsAppSetupPath(target.businessId)}?${productTestEntryMarker}=1`;
  const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });

  // Never replace a Super Admin credential. Anonymous users get a business
  // session, and explicit product-link navigation can switch among test tenants.
  if (currentSession?.role !== "admin") {
    const businessToken = await signIntegrationAccess(secret, { kind: "business", businessId: target.businessId }, Date.now(), "tany-dashboard-v1", 3600);
    response.cookies.set(dashboardSessionCookieName, businessToken, { ...dashboardSessionCookieOptions, maxAge: 3600 });
  }
  response.cookies.set(whatsappSetupSessionCookieName, await signWhatsAppSetupSession(secret, target.businessId), whatsappSetupSessionCookieOptions);
  return response;
}
