import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getPostgresBusinessProfile } from "@/lib/admin/postgres-directory";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "@/lib/admin/dashboard-cookie";
import { signWhatsAppSetupSession, whatsappSetupSessionCookieName, whatsappSetupSessionCookieOptions } from "@/lib/admin/whatsapp-setup-session";
import { signIntegrationAccess } from "@/lib/integration/access";
import { databaseMode } from "@/lib/data/repository";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { businessWhatsAppDashboardPath, businessWhatsAppSetupPath } from "@/lib/admin/whatsapp-setup-access";

export const productTestTenants = {
  retail: { businessId: "test-retail", vertical: "retail" },
  eats: { businessId: "test-eats", vertical: "eats" },
  motos: { businessId: "test-motos", vertical: "motos" },
} as const;

export type ProductTestProduct = keyof typeof productTestTenants;
const testBusinessIds = new Set<string>(Object.values(productTestTenants).map(({ businessId }) => businessId));
export const isProductTestBusiness = (businessId: string) => testBusinessIds.has(businessId);
const stagingMode = () => {
  const raw = process.env.DATABASE_URL ?? "";
  try {
    const url = new URL(raw);
    return process.env.MESSAGING_POSTGRES_TARGET === "staging" &&
      (databaseMode() === "postgres" || databaseMode() === "dual-write") &&
      !/prod|production|live/i.test(`${url.hostname}${url.pathname}`);
  } catch { return false; }
};

/** Public entry points intentionally grant access only to one fixed staging tenant. */
export async function productTestEntryResponse(request: NextRequest, product: ProductTestProduct) {
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
  if (!stagingMode()) return NextResponse.json({ message: "Product test workspaces are unavailable." }, { status: 404, headers });
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  if (secret.length < 32) return NextResponse.json({ message: "Product test workspaces are not configured." }, { status: 503, headers });

  const target = productTestTenants[product];
  const business = await getPostgresBusinessProfile(target.businessId);
  if (!business || !business.active || business.vertical !== target.vertical)
    return NextResponse.json({ message: "Product test workspace is unavailable." }, { status: 404, headers });

  const currentToken = request.cookies.get(dashboardSessionCookieName)?.value ?? "";
  const currentSession = await resolveDashboardSession(secret, currentToken);
  if (currentSession?.role === "business" && currentSession.businessId !== target.businessId && !testBusinessIds.has(currentSession.businessId))
    return NextResponse.json({ message: "Open this product test link from a separate signed-in workspace." }, { status: 403, headers });
  if (currentSession?.role === "selector")
    return NextResponse.json({ message: "Choose a product test link in a separate browser session." }, { status: 403, headers });

  const connection = await getClientWhatsAppConnection(target.businessId);
  const connected = connection.status === "connected" && connection.health === "verified";
  const location = connected ? businessWhatsAppDashboardPath(target.businessId) : businessWhatsAppSetupPath(target.businessId);
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
