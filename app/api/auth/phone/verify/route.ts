import { NextRequest, NextResponse } from "next/server";
import { PhoneLoginError, verifyPhoneLoginOtp } from "@/lib/admin/phone-login-service";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "@/lib/admin/dashboard-cookie";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const body = await request.json() as { phone?: unknown; code?: unknown };
    if (typeof body.phone !== "string" || typeof body.code !== "string") throw new PhoneLoginError("INVALID_OTP", 401);
    const result = await verifyPhoneLoginOtp(body.phone, body.code);
    const location = result.businesses.length === 1 ? `/business/${encodeURIComponent(result.selectedBusinessId!)}` : "/dashboard/select-business";
    const response = NextResponse.json({ businesses: result.businesses, location }, { headers });
    response.cookies.set(dashboardSessionCookieName, result.token, { ...dashboardSessionCookieOptions, maxAge: 8 * 60 * 60 });
    return response;
  } catch (error) {
    const failure = error instanceof PhoneLoginError ? error : null;
    const status = failure?.status ?? 503;
    const message = failure?.code === "RATE_LIMITED" ? "Too many attempts. Try again later." : failure?.code === "ACCOUNT_UNAVAILABLE" ? "This phone number does not have dashboard access." : failure?.code === "OTP_EXPIRED" ? "That code expired. Request a new one." : "The code is incorrect or could not be verified.";
    return NextResponse.json({ message }, { status, headers });
  }
}
