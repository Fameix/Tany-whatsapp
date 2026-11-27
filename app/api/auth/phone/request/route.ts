import { NextRequest, NextResponse } from "next/server";
import { PhoneLoginError, requestBusinessLoginOtp, requestPhoneLoginOtp } from "@/lib/admin/phone-login-service";

const messages: Partial<Record<PhoneLoginError["code"], string>> = {
  RATE_LIMITED: "Too many attempts. Try again later.",
  RESEND_COOLDOWN: "Please wait before requesting another code.",
  INVALID_PHONE: "Enter a valid phone number with country code.",
  WHATSAPP_UNAVAILABLE: "WhatsApp sign-in isn't available for this business yet.",
};

/** With a businessId, the code is sent on WhatsApp from that business's own number;
 * without one, the original SMS sign-in is used. */
export async function POST(request: NextRequest) {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ message: "Invalid request." }, { status: 413, headers });
    const body = await request.json() as { phone?: unknown; businessId?: unknown };
    if (typeof body.phone !== "string") throw new PhoneLoginError("INVALID_PHONE", 400);
    if (body.businessId !== undefined && typeof body.businessId !== "string") throw new PhoneLoginError("WHATSAPP_UNAVAILABLE", 503);
    const clientAddress = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
    if (body.businessId) await requestBusinessLoginOtp(body.businessId, body.phone, clientAddress);
    else await requestPhoneLoginOtp(body.phone, clientAddress);
    return NextResponse.json({ ok: true, channel: body.businessId ? "whatsapp" : "sms" }, { headers });
  } catch (error) {
    const failure = error instanceof PhoneLoginError ? error : null;
    if (failure?.retryAfterSeconds) headers["Retry-After"] = String(failure.retryAfterSeconds);
    return NextResponse.json({ message: (failure && messages[failure.code]) ?? "We could not send a code right now.", retryAfter: failure?.retryAfterSeconds || undefined },
      { status: failure?.status ?? 503, headers });
  }
}
