import { NextRequest, NextResponse } from "next/server";
import { revokePhoneLoginSession } from "@/lib/admin/phone-login-service";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "@/lib/admin/dashboard-cookie";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(dashboardSessionCookieName)?.value ?? "";
  await revokePhoneLoginSession(token);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(dashboardSessionCookieName, "", { ...dashboardSessionCookieOptions, maxAge: 0 });
  return response;
}
