import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { signIntegrationAccess } from "@/lib/integration/access";
import { dashboardSessionCookieName, dashboardSessionCookieOptions } from "./dashboard-cookie";
import { isStagingWorkerOrigin } from "./staging-environment";
import { stagingDirectorySigningKey } from "./directory-session";
import { resolveDashboardSession } from "./dashboard-access";
import { stagingBootstrapAttemptParam } from "./product-routes";

const maxAge = 60 * 60;

/** One bootstrap hop. If the browser declines the cookie, the next request reaches the normal guard. */
export async function bootstrapStagingSuperAdmin(request: NextRequest) {
  const url = new URL(request.nextUrl.href);
  if (request.method !== "GET" || !/^\/admin(?:\/|$)/.test(url.pathname) ||
      url.searchParams.has(stagingBootstrapAttemptParam) || !isStagingWorkerOrigin(url, request.headers.get("host"))) return null;

  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const token = request.cookies.get(dashboardSessionCookieName)?.value ?? "";
  if (secret.length < 32 || token.startsWith("otp_") || await resolveDashboardSession(secret, token, url.host)) return null;

  const session = await signIntegrationAccess(stagingDirectorySigningKey(secret),
    { kind: "directory" }, Date.now(), "tany-dashboard-v1", maxAge);
  url.searchParams.set(stagingBootstrapAttemptParam, "1");
  const response = NextResponse.redirect(url, 307);
  response.cookies.set(dashboardSessionCookieName, session, { ...dashboardSessionCookieOptions, secure: true, maxAge });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
