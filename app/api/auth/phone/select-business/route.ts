import { NextRequest, NextResponse } from "next/server";
import { listPhoneLoginBusinesses, PhoneLoginError, selectPhoneLoginBusiness } from "@/lib/admin/phone-login-service";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function tokenFrom(request: NextRequest) { return request.cookies.get(dashboardSessionCookieName)?.value ?? ""; }
function sameOrigin(request: NextRequest) { try { const origin = request.headers.get("origin"); return !!origin && new URL(origin).origin === request.nextUrl.origin; } catch { return false; } }

export async function GET(request: NextRequest) {
  try { return NextResponse.json({ businesses: await listPhoneLoginBusinesses(tokenFrom(request)) }, { headers }); }
  catch (error) { const failure = error instanceof PhoneLoginError ? error : null; return NextResponse.json({ message: "Sign in again to choose a business." }, { status: failure?.status ?? 503, headers }); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ message: "Invalid request origin." }, { status: 403, headers });
  try {
    const body = await request.json() as { businessId?: unknown };
    if (typeof body.businessId !== "string" || !body.businessId) throw new PhoneLoginError("BUSINESS_FORBIDDEN", 403);
    await selectPhoneLoginBusiness(tokenFrom(request), body.businessId);
    return NextResponse.json({ location: `/business/${encodeURIComponent(body.businessId)}` }, { headers });
  } catch (error) {
    const failure = error instanceof PhoneLoginError ? error : null;
    return NextResponse.json({ message: "That business is not available for this account." }, { status: failure?.status ?? 503, headers });
  }
}
