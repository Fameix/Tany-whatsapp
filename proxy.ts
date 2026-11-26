import { NextRequest, NextResponse } from "next/server";
import { signIntegrationAccess } from "@/lib/integration/access";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const localCookieOptions = { httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 7 * 24 * 60 * 60 };

/** Standalone internal console: client subscription/login policy belongs to the integration APIs. */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  // Local-only convenience: issue the same signed directory credential the
  // handoff route issues. The secret never leaves this server-side boundary.
  if (process.env.NODE_ENV === "development" && localHosts.has(request.nextUrl.hostname)) {
    const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
    const token = request.cookies.get("tany-dashboard-dev")?.value ?? "";
    // Never replace a valid business session with the directory (Super Admin) credential;
    // only a missing or invalid dashboard cookie receives the local convenience session.
    const valid = !!token && !token.startsWith("otp_") && (await resolveDashboardSession(secret, token)) !== null;
    if (!valid && !token.startsWith("otp_") && secret.length >= 32) {
      const credential = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 7 * 24 * 60 * 60);
      response.cookies.set("tany-dashboard-dev", credential, localCookieOptions);
    }
  }
  return response;
}
export const config = { matcher: ["/admin/:path*", "/business/:path*", "/dashboard/:path*"] };
