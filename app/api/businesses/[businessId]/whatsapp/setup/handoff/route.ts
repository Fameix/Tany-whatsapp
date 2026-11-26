import { NextRequest, NextResponse } from "next/server";
import { dashboardAccess } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { createWorkspaceHandoff } from "@/lib/admin/workspace-handoff";
import { businessWhatsAppSetupPath } from "@/lib/admin/whatsapp-setup-access";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

function sameOrigin(request: NextRequest) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    return origin.origin === request.headers.get("origin") && origin.host === requestHost &&
      (origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
  } catch { return false; }
}

export async function POST(request: NextRequest, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const access = await dashboardAccess(secret, request.cookies.get(dashboardSessionCookieName)?.value ?? "", businessId);
  if (!access) return NextResponse.json({ message: "Business access required." }, { status: 403, headers });
  if (!sameOrigin(request)) return NextResponse.json({ message: "Invalid request origin." }, { status: 403, headers });
  try {
    const handoff = await createWorkspaceHandoff(businessId);
    const next = businessWhatsAppSetupPath(businessId);
    const url = new URL(handoff.path, request.nextUrl.origin);
    url.searchParams.set("next", next);
    return NextResponse.json({ path: `${url.pathname}${url.search}` }, { headers });
  } catch {
    return NextResponse.json({ message: "Could not open business WhatsApp setup." }, { status: 503, headers });
  }
}
