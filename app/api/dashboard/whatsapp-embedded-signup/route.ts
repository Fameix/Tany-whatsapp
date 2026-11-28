import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { verifyWhatsAppSetupSession, whatsappSetupSessionCookieName, whatsappSetupSessionCookieOptions } from "@/lib/admin/whatsapp-setup-session";
import { completeEmbeddedSignup } from "@/lib/whatsapp/embedded-signup-service";
import { SetupError } from "@/lib/whatsapp/setup-service";
import { productWorkspaceRoot, workspaceProductFor } from "@/lib/admin/product-workspace";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function sameOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return origin.origin === request.headers.get("origin") && origin.host === request.nextUrl.host &&
      (origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
  } catch { return false; }
}
/** After setup a Super Admin returns to the product workspace (e.g. Tany Retail); a business to its own page. */
function setupReturnPath(businessId: string, superAdmin: boolean) {
  const product = superAdmin ? workspaceProductFor(businessId) : null;
  return product ? `${productWorkspaceRoot(product)}/whatsapp` : `/business/${encodeURIComponent(businessId)}/whatsapp`;
}

export async function POST(request: NextRequest) {
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const requestedBusinessId = request.nextUrl.searchParams.get("businessId") ?? "";
  const session = await resolveDashboardSession(secret, request.cookies.get(dashboardSessionCookieName)?.value ?? "");
  const setupContextValid = !!requestedBusinessId && await verifyWhatsAppSetupSession(secret, request.cookies.get(whatsappSetupSessionCookieName)?.value ?? "", requestedBusinessId);
  if (setupContextValid && session?.role === "business" && session.businessId !== requestedBusinessId)
    return NextResponse.json({ code: "BUSINESS_MISMATCH", message: "This setup session belongs to another business." }, { status: 403, headers });
  const businessId = setupContextValid ? requestedBusinessId : session?.role === "business" && (!requestedBusinessId || session.businessId === requestedBusinessId) ? session.businessId : "";
  if (!businessId) return NextResponse.json({ code: requestedBusinessId ? "BUSINESS_MISMATCH" : "UNAUTHORIZED", message: "Open WhatsApp setup from the selected business." }, { status: requestedBusinessId ? 403 : 401, headers });
  if (!sameOrigin(request)) return NextResponse.json({ code: "INVALID_ORIGIN", message: "Invalid request origin." }, { status: 403, headers });
  try {
    const account = await completeEmbeddedSignup(businessId, await request.json());
    console.info("[EMBEDDED_SIGNUP] COMPLETE", { businessId, status: account?.status, redirect: `/business/${encodeURIComponent(businessId)}/whatsapp` });
    const response = NextResponse.json({ ok: true, dashboardUrl: setupReturnPath(businessId, session?.role === "admin"), account: { status: account?.status } }, { headers });
    if (setupContextValid) response.cookies.set(whatsappSetupSessionCookieName, "", { ...whatsappSetupSessionCookieOptions, maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof SetupError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers });
    console.error("[EMBEDDED_SIGNUP] UNEXPECTED_FAILURE", { businessId, error: error instanceof Error ? error.name : typeof error });
    return NextResponse.json({ ok: false, code: "SIGNUP_FAILED", message: "Could not complete WhatsApp signup. Please try again." }, { status: error instanceof SyntaxError ? 400 : 503, headers });
  }
}
