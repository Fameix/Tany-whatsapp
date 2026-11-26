import { NextRequest, NextResponse } from "next/server";
import { getOperationsData } from "@/lib/admin/operations-service";
import { OperationsAccessError } from "@/lib/admin/client-access";
import { mutateClientOperations, sendOperatorMessage } from "@/lib/admin/client-operations";
import { EntitlementError } from "@/lib/subscriptions/entitlements";
import { DashboardAuthorizationError, getDashboardSession, requireDashboardAccess } from "@/lib/admin/dashboard-session";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
async function handle(request: NextRequest, mutate: boolean) {
  try {
    const requested = request.nextUrl.searchParams.get("businessId") ?? undefined;
    const principal = await getDashboardSession();
    await requireDashboardAccess(requested);
    if (!mutate) return NextResponse.json({ ok: true, data: { ...await getOperationsData(requested), audience: principal.role } }, { headers });
    let sameOrigin = false;
    try {
      const origin = new URL(request.headers.get("origin") ?? "");
      sameOrigin = origin.origin === request.headers.get("origin") && origin.host === (request.headers.get("host") ?? request.nextUrl.host) && (origin.protocol === "https:" || (origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)));
    } catch { /* Invalid origins are denied. */ }
    if (!sameOrigin) throw new OperationsAccessError("INVALID_ORIGIN", "Invalid request origin.");
    const input = await request.json();
    if (typeof input?.action !== "string") throw new OperationsAccessError("INVALID_INPUT", "Choose an action.", 400);
    const internalConsole = principal.role === "admin";
    const result = input.action === "send" ? await sendOperatorMessage(principal, requested, input.input, internalConsole) : await mutateClientOperations(principal, requested, input.action, input.input, internalConsole);
    return NextResponse.json({ ok: true, result }, { headers });
  } catch (error) {
    if (error instanceof DashboardAuthorizationError)
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED", message: error.message }, { status: error.status, headers });
    if (error instanceof EntitlementError) return NextResponse.json(error.details, { status: 403, headers });
    if (error instanceof OperationsAccessError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers });
    return NextResponse.json({ ok: false, message: "Could not complete this action. Please try again." }, { status: error instanceof SyntaxError ? 400 : 503, headers });
  }
}
export async function GET(request: NextRequest) { return handle(request, false); }
export async function POST(request: NextRequest) { return handle(request, true); }
