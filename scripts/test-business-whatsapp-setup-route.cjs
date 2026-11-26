/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHarness } = require("./messaging-test-helpers.cjs");

const origin = "https://dashboard.test";
const secret = "business-setup-route-secret-long-enough-for-hmac-2026";
const cookieValue = (response, name) => {
  const header = response.headers.getSetCookie?.() ?? [];
  const entry = header.find((value) => value.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1).split(";")[0] : null;
};

async function main() {
  process.env.MESSAGING_SERVICE_SECRET = secret;
  const h = createHarness();
  const { NextRequest } = require("next/server");
  const { signIntegrationAccess } = h.load("lib/integration/access.ts");
  const { resolveDashboardSession } = h.load("lib/admin/dashboard-access.ts");
  const { dashboardSessionCookieName } = h.load("lib/admin/dashboard-cookie.ts");
  const { signWhatsAppSetupSession, whatsappSetupSessionCookieName } = h.load("lib/admin/whatsapp-setup-session.ts");
  const { resolveWhatsAppSetupAccess, businessSetupRouteBusinessId, businessWhatsAppSetupPath, businessWhatsAppDashboardPath } = h.load("lib/admin/whatsapp-setup-access.ts");
  const { createWorkspaceHandoff } = h.load("lib/admin/workspace-handoff.ts");

  const adminToken = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 3600);
  const retailToken = await signIntegrationAccess(secret, { kind: "business", businessId: "demo-retail" }, Date.now(), "tany-dashboard-v1", 3600);
  const eatsToken = await signIntegrationAccess(secret, { kind: "business", businessId: "demo-eats" }, Date.now(), "tany-dashboard-v1", 3600);
  const retailSetup = await signWhatsAppSetupSession(secret, "demo-retail");
  const eatsSetup = await signWhatsAppSetupSession(secret, "demo-eats");

  // 1. Business setup route: resolved from the route plus an authorized business credential.
  assert.equal(businessWhatsAppSetupPath("demo-retail"), "/business/demo-retail/whatsapp/setup");
  assert.equal(businessWhatsAppDashboardPath("demo-retail"), "/business/demo-retail/whatsapp");
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, retailToken, "", "demo-retail"), { ok: true, via: "business-session" });
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, "", retailSetup, "demo-retail"), { ok: true, via: "setup-session" });
  assert.equal(businessSetupRouteBusinessId("/business/demo-retail/whatsapp/setup", origin), "demo-retail");
  for (const bad of ["/business/demo-retail/whatsapp/setup?x=1", "https://evil.test/business/demo-retail/whatsapp/setup", "/business/demo-retail/whatsapp", "/business/a%2Fb/whatsapp/setup"])
    assert.equal(businessSetupRouteBusinessId(bad, origin), null, bad);

  // 2. Super Admin session present but does not hijack, and is never converted.
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, adminToken, "", "demo-retail"), { ok: false, reason: "admin-requires-handoff" });
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, adminToken, retailSetup, "demo-retail"), { ok: true, via: "setup-session" });
  assert.deepEqual(await resolveDashboardSession(secret, adminToken), { role: "admin" }, "Super Admin session stays a Super Admin session");

  // 3. Unauthorized / wrong business rejected.
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, eatsToken, "", "demo-retail"), { ok: false, reason: "wrong-business" });
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, eatsToken, retailSetup, "demo-retail"), { ok: false, reason: "wrong-business" }, "a setup cookie cannot override another tenant's session");
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, "", eatsSetup, "demo-retail"), { ok: false, reason: "unauthenticated" }, "setup session cannot be replayed for another business");
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, "", "", "demo-retail"), { ok: false, reason: "unauthenticated" });
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, "garbage", "garbage", "demo-retail"), { ok: false, reason: "unauthenticated" });

  // Handoff CTA (Connect / Continue setup / Reconnect) targets the scoped route.
  const handoffRoute = h.load("app/api/businesses/[businessId]/whatsapp/setup/handoff/route.ts");
  const handoffRequest = (token, businessId) => new NextRequest(`${origin}/api/businesses/${businessId}/whatsapp/setup/handoff`, { method: "POST", headers: { origin, cookie: `${dashboardSessionCookieName}=${token}` } });
  const handoffResponse = await handoffRoute.POST(handoffRequest(adminToken, "demo-retail"), { params: Promise.resolve({ businessId: "demo-retail" }) });
  assert.equal(handoffResponse.status, 200);
  const handoffPath = new URL((await handoffResponse.json()).path, origin);
  assert.equal(handoffPath.pathname, "/api/dashboard/connect");
  assert.equal(handoffPath.searchParams.get("next"), "/business/demo-retail/whatsapp/setup");
  assert.equal((await handoffRoute.POST(handoffRequest(eatsToken, "demo-retail"), { params: Promise.resolve({ businessId: "demo-retail" }) })).status, 403, "another tenant cannot start Demo Retail setup");

  // Connect consumes the handoff, issues only the scoped setup cookie and keeps the Super Admin session.
  const connectRoute = h.load("app/api/dashboard/connect/route.ts");
  const connectFor = (token, path) => connectRoute.GET(new NextRequest(`${origin}${path}`, { headers: { cookie: `${dashboardSessionCookieName}=${token}` } }));
  const connect = (path) => connectFor(adminToken, path);
  const connected = await connect(`${handoffPath.pathname}${handoffPath.search}`);
  assert.equal(connected.status, 303);
  assert.equal(connected.headers.get("location"), "/business/demo-retail/whatsapp/setup");
  assert.equal(cookieValue(connected, dashboardSessionCookieName), null, "Super Admin dashboard cookie must not be replaced");
  const issuedSetup = cookieValue(connected, whatsappSetupSessionCookieName);
  assert.ok(issuedSetup, "scoped setup cookie issued");
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, adminToken, decodeURIComponent(issuedSetup), "demo-retail"), { ok: true, via: "setup-session" });
  assert.deepEqual(await resolveWhatsAppSetupAccess(secret, adminToken, decodeURIComponent(issuedSetup), "demo-eats"), { ok: false, reason: "admin-requires-handoff" });
  const replay = await connect(`${handoffPath.pathname}${handoffPath.search}`);
  assert.equal(replay.status, 400, "handoff token is single-use");
  const mismatch = new URL((await createWorkspaceHandoff("demo-retail")).path, origin);
  mismatch.searchParams.set("next", "/business/demo-eats/whatsapp/setup");
  assert.equal((await connect(`${mismatch.pathname}${mismatch.search}`)).status, 403, "handoff for Demo Retail cannot open another business's setup");

  // Postgres-only staging tenants use the same generic, tenant-scoped handoff.
  const previousDatabase = process.env.MESSAGING_DATABASE;
  process.env.MESSAGING_DATABASE = "postgres";
  const directory = h.load("lib/admin/postgres-directory.ts");
  const productTenants = { "test-retail": "retail", "test-eats": "eats", "test-motos": "motos" };
  directory.getPostgresBusinessProfile = async (businessId) => productTenants[businessId]
    ? { id: businessId, name: businessId, vertical: productTenants[businessId], active: true }
    : null;
  const productTokens = {};
  try {
    for (const businessId of Object.keys(productTenants)) {
      productTokens[businessId] = await signIntegrationAccess(secret, { kind: "business", businessId }, Date.now(), "tany-dashboard-v1", 3600);
      const response = await handoffRoute.POST(handoffRequest(productTokens[businessId], businessId), { params: Promise.resolve({ businessId }) });
      assert.equal(response.status, 200, `${businessId} Postgres handoff`);
      const target = new URL((await response.json()).path, origin);
      assert.equal(target.searchParams.get("next"), `/business/${businessId}/whatsapp/setup`);
      const destination = await connectFor(productTokens[businessId], `${target.pathname}${target.search}`);
      assert.equal(destination.status, 303);
      assert.equal(destination.headers.get("location"), `/business/${businessId}/whatsapp/setup`);
      assert.equal(cookieValue(destination, dashboardSessionCookieName), null, "business session is not broadened");
      const productSetup = cookieValue(destination, whatsappSetupSessionCookieName);
      assert.ok(productSetup);
      assert.deepEqual(await resolveWhatsAppSetupAccess(secret, productTokens[businessId], decodeURIComponent(productSetup), businessId), { ok: true, via: "business-session" });
      console.log(`PASS ${businessId} opens only /business/${businessId}/whatsapp/setup`);
    }
    assert.equal((await handoffRoute.POST(handoffRequest(productTokens["test-eats"], "test-retail"), { params: Promise.resolve({ businessId: "test-retail" }) })).status, 403);
    const publicOrigin = "https://staging.tany.in";
    const tunneledRequest = new NextRequest("http://localhost:3000/api/businesses/test-retail/whatsapp/setup/handoff", {
      method: "POST",
      headers: { origin: publicOrigin, "x-forwarded-host": new URL(publicOrigin).host, cookie: `${dashboardSessionCookieName}=${productTokens["test-retail"]}` },
    });
    assert.equal((await handoffRoute.POST(tunneledRequest, { params: Promise.resolve({ businessId: "test-retail" }) })).status, 200, "trusted staging tunnel origin is accepted");
    const adminTest = await handoffRoute.POST(handoffRequest(adminToken, "test-retail"), { params: Promise.resolve({ businessId: "test-retail" }) });
    assert.equal(adminTest.status, 200, "Super Admin can explicitly start the selected staging tenant setup");
    assert.deepEqual(await resolveDashboardSession(secret, adminToken), { role: "admin" }, "product handoff preserves the Super Admin session");
  } finally {
    if (previousDatabase === undefined) delete process.env.MESSAGING_DATABASE; else process.env.MESSAGING_DATABASE = previousDatabase;
  }

  // Dev proxy keeps a valid business session instead of converting it to Super Admin.
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const { proxy } = h.load("proxy.ts");
    const devRequest = (token) => new NextRequest("http://localhost:3000/business/demo-retail/whatsapp/setup", { headers: { cookie: token ? `tany-dashboard-dev=${token}` : "" } });
    assert.equal(cookieValue(await proxy(devRequest(retailToken)), "tany-dashboard-dev"), null, "valid business session is not replaced");
    assert.equal(cookieValue(await proxy(devRequest(adminToken)), "tany-dashboard-dev"), null);
    assert.ok(cookieValue(await proxy(devRequest("")), "tany-dashboard-dev"), "missing session still gets the local convenience credential");
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
  }

  // 4. Successful Meta signup keeps businessId and redirects to the business WhatsApp dashboard.
  const signupService = h.load("lib/whatsapp/embedded-signup-service.ts");
  const exchanged = [];
  signupService.completeEmbeddedSignup = async (businessId, body) => { exchanged.push({ businessId, body }); return { status: "connected" }; };
  const signupRoute = h.load("app/api/dashboard/whatsapp-embedded-signup/route.ts");
  const signup = (businessId, cookie) => signupRoute.POST(new NextRequest(`${origin}/api/dashboard/whatsapp-embedded-signup?businessId=${businessId}`, {
    method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: JSON.stringify({ code: "meta-auth-code-123456" }),
  }));
  const success = await signup("demo-retail", `${dashboardSessionCookieName}=${adminToken}; ${whatsappSetupSessionCookieName}=${issuedSetup}`);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).dashboardUrl, "/business/demo-retail/whatsapp");
  assert.deepEqual(exchanged.at(-1), { businessId: "demo-retail", body: { code: "meta-auth-code-123456" } });
  const businessSuccess = await signup("demo-retail", `${dashboardSessionCookieName}=${retailToken}`);
  assert.equal((await businessSuccess.json()).dashboardUrl, "/business/demo-retail/whatsapp");
  assert.equal((await signup("demo-retail", `${dashboardSessionCookieName}=${adminToken}`)).status, 403, "Super Admin alone cannot complete business signup");
  assert.equal((await signup("demo-retail", `${dashboardSessionCookieName}=${eatsToken}`)).status, 403);
  assert.equal(exchanged.length, 2, "rejected requests never reach the Meta exchange");

  for (const businessId of Object.keys(productTenants)) {
    const response = await signup(businessId, `${dashboardSessionCookieName}=${productTokens[businessId]}`);
    assert.equal(response.status, 200, `${businessId} signup request`);
    assert.equal((await response.json()).dashboardUrl, `/business/${businessId}/whatsapp`);
    assert.equal(exchanged.at(-1).businessId, businessId, "Meta signup keeps the selected product tenant");
  }
  assert.equal((await signup("test-retail", `${dashboardSessionCookieName}=${productTokens["test-eats"]}`)).status, 403, "wrong test tenant cannot submit the signup");
  assert.equal(exchanged.length, 5, "wrong tenant never reaches the Meta exchange");

  // Page and CTAs use the scoped route; the generic dashboard route is not used for business setup.
  const page = fs.readFileSync("app/business/[businessId]/whatsapp/setup/page.tsx", "utf8");
  assert.match(page, /resolveWhatsAppSetupAccess\(/);
  assert.match(page, /access\.reason === "admin-requires-handoff"\) redirect\(dashboardHref\)/);
  assert.match(page, /<WhatsAppConnection initialConnection=\{clientConnection\} embeddedSignup=\{embeddedSignupClientConfiguration\(\)\} dashboardHref=\{dashboardHref\} businessId=\{businessId\} connectLabel=\{/);
  const connectComponent = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-connection.tsx", "utf8");
  assert.match(connectComponent, /disabled=\{busy\} onClick=\{launchEmbeddedSignup\}/, "loading Meta does not silently disable the Connect action");
  assert.match(connectComponent, /Meta is still loading\. Please try again in a moment\./, "early click reports the Meta loading state");
  const accountActions = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-account-actions.tsx", "utf8");
  assert.match(accountActions, /response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/, "non-JSON handoff errors are handled");
  assert.match(accountActions, /HTTP \$\{response\.status\}/, "API status is shown when no safe error message is returned");
  assert.match(accountActions, /role="alert"/, "handoff error is surfaced to the user");
  for (const file of ["app/admin/components/operations-panel.tsx", "app/admin/components/client-workspace-menu.tsx", "app/business/[businessId]/whatsapp/actions.ts", "app/dashboard/messaging/_components/whatsapp-account-actions.tsx", "app/api/businesses/[businessId]/whatsapp/setup/handoff/route.ts"])
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\/dashboard\/messaging\/setup/, `${file} must not use the generic setup route`);

  console.log("PASS business-scoped /business/{id}/whatsapp/setup: route access, Super Admin no-hijack/no-conversion, wrong business rejected, scoped handoff, successful redirect to /business/{id}/whatsapp.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
