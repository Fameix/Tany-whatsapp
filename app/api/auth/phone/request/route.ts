import { NextRequest, NextResponse } from "next/server";
import { PhoneLoginError, requestPhoneLoginOtp } from "@/lib/admin/phone-login-service";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ message: "Invalid request." }, { status: 413, headers });
    const body = await request.json() as { phone?: unknown };
    if (typeof body.phone !== "string") throw new PhoneLoginError("INVALID_PHONE", 400);
    const clientAddress = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
    await requestPhoneLoginOtp(body.phone, clientAddress);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    const failure = error instanceof PhoneLoginError ? error : null;
    return NextResponse.json({ message: failure?.code === "RATE_LIMITED" ? "Too many attempts. Try again later." : failure?.code === "INVALID_PHONE" ? "Enter a valid phone number with country code." : "We could not send a code right now." }, { status: failure?.status ?? 503, headers });
  }
}
