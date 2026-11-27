import { NextRequest, NextResponse } from "next/server";
import { DashboardAuthorizationError } from "@/lib/admin/dashboard-session";
import { requireProductWhatsAppBusiness } from "@/lib/admin/product-whatsapp-access";
import { adminProductPath } from "@/lib/admin/product-routes";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { completeEmbeddedSignup } from "@/lib/whatsapp/embedded-signup-service";
import { disconnectWhatsAppSetup, SetupError } from "@/lib/whatsapp/setup-service";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers });

export async function POST(request: NextRequest, { params }: { params: Promise<{ product: string; businessId: string }> }) {
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin || request.nextUrl.protocol !== "https:") return json({ message: "Invalid request origin." }, 403);
  const { product, businessId } = await params;
  if (!isActiveTanyVertical(product)) return json({ message: "Product unavailable." }, 404);
  try {
    await requireProductWhatsAppBusiness(product, businessId, true);
    const action = request.nextUrl.searchParams.get("action");
    if (action === "signup") {
      await completeEmbeddedSignup(businessId, await request.json());
      return json({ ok: true, dashboardUrl: `${adminProductPath(product)}/whatsapp?business=${encodeURIComponent(businessId)}` });
    }
    if (action === "disconnect") {
      await disconnectWhatsAppSetup(businessId);
      return json({ ok: true });
    }
    return json({ message: "Choose a valid connection action." }, 400);
  } catch (error) {
    if (error instanceof DashboardAuthorizationError || error instanceof SetupError) return json({ message: error.message }, error.status);
    return json({ message: "Could not update WhatsApp. Please try again." }, error instanceof SyntaxError ? 400 : 503);
  }
}
