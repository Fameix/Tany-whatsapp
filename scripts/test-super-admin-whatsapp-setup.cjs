/* eslint-disable @typescript-eslint/no-require-imports */
// Super Admin → a product workspace (Tany Retail → test-retail) can start WhatsApp setup: the handoff
// route issues only the short-lived, business-scoped setup session (no business dashboard session,
// no Firestore handoff), on staging only, and setup returns to /admin/products/<product>/whatsapp.
// Reads test-retail from staging; writes nothing. Never reaches the Firestore handoff path.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadEnvConfig } = require("@next/env");

async function main() {
  loadEnvConfig(process.cwd());
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "requires explicit staging target");
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  assert.ok(secret.length >= 32, "MESSAGING_SERVICE_SECRET required");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../app/api/businesses/[businessId]/whatsapp/setup/handoff/route.ts");
  const { signIntegrationAccess } = await import("../lib/integration/access.ts");
  const { verifyWhatsAppSetupSession, whatsappSetupSessionCookieName } = await import("../lib/admin/whatsapp-setup-session.ts");
  const { dashboardSessionCookieName } = await import("../lib/admin/dashboard-cookie.ts");
  const host = "tany-whatsapp.tany-8b9.workers.dev";
  const superAdmin = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 600);
  const call = (businessId, { cookie = superAdmin, origin = `https://${host}` } = {}) => POST(
    new NextRequest(`https://${host}/api/businesses/${businessId}/whatsapp/setup/handoff`, {
      method: "POST", headers: { host, origin, cookie: cookie ? `${dashboardSessionCookieName}=${cookie}` : "" },
    }),
    { params: Promise.resolve({ businessId }) },
  );

  const response = await call("test-retail");
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, { path: "/admin/products/retail/whatsapp/setup" }, "straight to setup inside Tany Retail, no handoff token");
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1, "only one cookie is set");
  const setup = cookies[0].match(new RegExp(`^${whatsappSetupSessionCookieName}=([^;]+)`))?.[1];
  assert.ok(setup, "the setup-session cookie is set");
  assert.match(cookies[0], /HttpOnly/i);
  assert.match(cookies[0], /SameSite=lax/i);
  assert.ok(!cookies.some(cookie => cookie.startsWith(`${dashboardSessionCookieName}=`)), "no business dashboard session is created");
  assert.equal(await verifyWhatsAppSetupSession(secret, setup, "test-retail"), true, "valid for test-retail");
  for (const other of ["test-eats", "test-motos", "demo-retail"]) assert.equal(await verifyWhatsAppSetupSession(secret, setup, other), false, `not valid for ${other}`);
  console.log("PASS Super Admin starts test-retail setup: one HttpOnly setup-session cookie for test-retail only; no business session; no Firestore handoff");

  assert.equal((await call("test-retail", { cookie: "" })).status, 403, "no session → no setup");
  assert.equal((await call("test-retail", { cookie: "not-a-real-token" })).status, 403, "forged session → no setup");
  assert.equal((await call("test-retail", { origin: "https://evil.example" })).status, 403, "cross-origin → no setup");
  const businessSession = await signIntegrationAccess(secret, { kind: "business", businessId: "test-eats" }, Date.now(), "tany-dashboard-v1", 600);
  assert.equal((await call("test-retail", { cookie: businessSession })).status, 403, "another business's session → no setup");
  console.log("PASS no session, forged session, other business's session and cross-origin requests are refused");

  const route = fs.readFileSync("app/api/businesses/[businessId]/whatsapp/setup/handoff/route.ts", "utf8");
  assert.match(route, /const product = access === "admin" \? workspaceProductFor\(businessId\) : null;\s*if \(product && canIncludeStagingTestData\(/, "Super Admin, product workspace tenant, staging only");
  assert.ok(route.indexOf("if (!access)") < route.indexOf('access === "admin" ? workspaceProductFor') && route.indexOf("if (!sameOrigin(request))") < route.indexOf('access === "admin" ? workspaceProductFor'), "session and origin are checked first");
  assert.match(route, /const handoff = await createWorkspaceHandoff\(businessId\);/, "every other case keeps the existing handoff");
  const page = fs.readFileSync("app/business/[businessId]/whatsapp/setup/page.tsx", "utf8");
  assert.match(page, /product && \(await isSuperAdmin\(\)\) \? `\$\{productWorkspaceRoot\(product\)\}\/whatsapp` : `\$\{await workspaceRoot\(businessId\)\}\/whatsapp`/, "setup page returns a Super Admin to the product workspace");
  const signup = fs.readFileSync("app/api/dashboard/whatsapp-embedded-signup/route.ts", "utf8");
  assert.match(signup, /dashboardUrl: setupReturnPath\(businessId, session\?\.role === "admin"\)/, "after Meta signup a Super Admin returns to the product workspace");
  assert.match(signup, /: `\/business\/\$\{encodeURIComponent\(businessId\)\}\/whatsapp`;/, "a business still returns to its own WhatsApp page");
  const { canIncludeStagingTestData } = await import("../lib/admin/staging-environment.ts");
  assert.equal(canIncludeStagingTestData("tany-messaging.example.com"), false, "never on any other host (production stays strict)");
  console.log("PASS staging and product-workspace tenants only; every other case unchanged; setup returns a Super Admin to /admin/products/<product>/whatsapp");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
