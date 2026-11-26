import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { disconnectWhatsAppSetup, SetupError } from "@/lib/whatsapp/setup-service";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Business context: a business session is limited to its own business (a different
 * `?businessId=` is rejected); a Super Admin session must name the business explicitly. */
async function businessFor(request: NextRequest): Promise<{ businessId: string } | { status: 401 | 403; code: string; message: string }> {
  const session = await resolveDashboardSession(
    process.env.MESSAGING_SERVICE_SECRET ?? "",
    request.cookies.get(dashboardSessionCookieName)?.value ?? "",
  );
  const requested = request.nextUrl.searchParams.get("businessId")?.trim() ?? "";
  if (session?.role === "business") {
    if (requested && requested !== session.businessId)
      return { status: 403, code: "BUSINESS_MISMATCH", message: "This WhatsApp account belongs to another business." };
    return { businessId: session.businessId };
  }
  if (session?.role === "admin" && requested && requested.length <= 1500 && !requested.includes("/"))
    return { businessId: requested };
  return { status: 401, code: "UNAUTHORIZED", message: "Open WhatsApp from your Tany account." };
}

function sameOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    return (
      origin.origin === request.headers.get("origin") &&
      origin.host === request.nextUrl.host &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const access = await businessFor(request);
  if (!("businessId" in access))
    return NextResponse.json({ code: access.code, message: access.message }, { status: access.status, headers });
  const { businessId } = access;
  try {
    return NextResponse.json(
      { ok: true, connection: await getClientWhatsAppConnection(businessId) },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Could not load the WhatsApp connection." },
      { status: 503, headers },
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await businessFor(request);
  if (!("businessId" in access))
    return NextResponse.json({ code: access.code, message: access.message }, { status: access.status, headers });
  const { businessId } = access;
  if (!sameOrigin(request))
    return NextResponse.json(
      { code: "INVALID_ORIGIN", message: "Invalid request origin." },
      { status: 403, headers },
    );
  try {
    const body = await request.json();
    if (body?.action !== "disconnect")
      return NextResponse.json(
        { code: "INVALID_ACTION", message: "Choose a valid connection action." },
        { status: 400, headers },
      );
    await disconnectWhatsAppSetup(businessId);
    console.info("[WHATSAPP_DISCONNECT] OK", { businessId });
    return NextResponse.json(
      { ok: true, connection: await getClientWhatsAppConnection(businessId) },
      { headers },
    );
  } catch (error) {
    console.error("[WHATSAPP_DISCONNECT] FAILED", { businessId, code: error instanceof SetupError ? error.code : undefined, error: error instanceof Error ? error.name : typeof error });
    if (error instanceof SetupError)
      return NextResponse.json({ ok: false, code: error.code, message: error.message === "Account unavailable." ? "There is no WhatsApp connection to disconnect for this business." : error.message }, { status: error.status, headers });
    return NextResponse.json(
      { ok: false, message: "Could not update the WhatsApp connection." },
      { status: error instanceof SyntaxError ? 400 : 503, headers },
    );
  }
}
