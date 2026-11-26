/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness } = require("./messaging-test-helpers.cjs");

const origin = "https://staging.test";
const secret = "product-test-entry-secret-long-enough-for-hmac-2026";
const cookieValue = (response, name) => {
  const entry = (response.headers.getSetCookie?.() ?? []).find((value) => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1).split(";")[0]) : null;
};

async function main() {
  process.env.MESSAGING_POSTGRES_TARGET = "staging";
  process.env.MESSAGING_DATABASE = "postgres";
  process.env.DATABASE_URL = "postgresql://staging.test/messaging";
  process.env.MESSAGING_SERVICE_SECRET = secret;
  const h = createHarness({ seedFixtures: false });
  const { NextRequest } = require("next/server");
  const directory = h.load("lib/admin/postgres-directory.ts");
  const connections = h.load("lib/whatsapp/client-connection.ts");
  const sessions = h.load("lib/admin/dashboard-access.ts");
  const access = h.load("lib/integration/access.ts");
  const cookies = h.load("lib/admin/dashboard-cookie.ts");
  const setupCookies = h.load("lib/admin/whatsapp-setup-session.ts");
  const { productTestEntryResponse } = h.load("lib/admin/product-test-entry.ts");
  const profiles = {
    "test-retail": { id: "test-retail", name: "Test Retail", vertical: "retail", active: true },
    "test-eats": { id: "test-eats", name: "Test Eats", vertical: "eats", active: true },
    "test-motos": { id: "test-motos", name: "Test Motos", vertical: "motos", active: true },
  };
  directory.getPostgresBusinessProfile = async (id) => profiles[id] ?? null;
  connections.getClientWhatsAppConnection = async (id) => ({ status: id === "test-motos" ? "connected" : "pending", health: id === "test-motos" ? "verified" : "not_available" });
  const request = (path, token = "") => new NextRequest(`${origin}${path}`, { headers: token ? { cookie: `${cookies.dashboardSessionCookieName}=${token}` } : {} });

  for (const [product, businessId] of [["retail", "test-retail"], ["eats", "test-eats"], ["motos", "test-motos"]]) {
    const response = await productTestEntryResponse(request(`/${product}`), product);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `/business/${businessId}/whatsapp${product === "motos" ? "" : "/setup"}`);
    const session = await sessions.resolveDashboardSession(secret, cookieValue(response, cookies.dashboardSessionCookieName));
    assert.deepEqual(session, { role: "business", businessId });
  }
  console.log("PASS each product entry resolves only its mapped tenant and Motos connected account opens its dashboard");

  profiles["test-retail"] = { ...profiles["test-retail"], vertical: "eats" };
  assert.equal((await productTestEntryResponse(request("/retail"), "retail")).status, 404, "wrong product data cannot open Retail workspace");
  profiles["test-retail"] = { id: "test-retail", name: "Test Retail", vertical: "retail", active: true };
  console.log("PASS wrong tenant product configuration is blocked");

  const admin = await access.signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 3600);
  const adminResponse = await productTestEntryResponse(request("/retail", admin), "retail");
  assert.equal(cookieValue(adminResponse, cookies.dashboardSessionCookieName), null, "Super Admin cookie is never converted");
  assert.ok(cookieValue(adminResponse, setupCookies.whatsappSetupSessionCookieName), "only a product-scoped setup handoff is added");
  assert.equal((await sessions.resolveDashboardSession(secret, admin)).role, "admin");

  const unrelated = await access.signIntegrationAccess(secret, { kind: "business", businessId: "demo-retail" }, Date.now(), "tany-dashboard-v1", 3600);
  assert.equal((await productTestEntryResponse(request("/retail", unrelated), "retail")).status, 403);
  console.log("PASS Super Admin stays unchanged and an unrelated business session cannot enter a product test tenant");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
