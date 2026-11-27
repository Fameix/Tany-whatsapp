/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { createHarness } = require("./messaging-test-helpers.cjs");

async function main() {
  process.env.MESSAGING_DATABASE = "postgres";
  const h = createHarness({ seedFixtures: false });
  const sessions = h.load("lib/admin/dashboard-session.ts");
  const preferences = h.load("lib/admin/product-test-data.ts");
  const scopes = h.load("lib/admin/product-scope.ts");
  const setup = h.load("lib/whatsapp/setup-service.ts");
  const signup = h.load("lib/whatsapp/embedded-signup-service.ts");
  const profile = h.load("lib/whatsapp/business-profile.ts");
  let role = "admin";
  let local = false;
  let include = true;
  const calls = [];
  sessions.requireDashboardAccess = async () => role;
  preferences.productTestDataPreference = async () => ({ include, local });
  scopes.listProductProfiles = async (product, includeTest) => includeTest ? [{ id: `test-${product}`, name: product, active: true }] : [];
  setup.disconnectWhatsAppSetup = async id => { calls.push(["disconnect", id]); };
  signup.completeEmbeddedSignup = async (id, data) => { calls.push(["signup", id, data.code]); };
  profile.getBusinessProfile = async id => { calls.push(["profile", id]); return { profile: {} }; };
  h.load("app/business/_components/load-business.ts").loadBusiness = async () => ({});
  const route = h.load("app/api/admin/products/[product]/whatsapp/[businessId]/route.ts");
  const profileActions = h.load("app/business/_components/whatsapp-profile/actions.ts");
  const origin = "https://staging.example";
  const post = (product, businessId, action, requestOrigin = origin) => route.POST(new NextRequest(
    `${origin}/api/admin/products/${product}/whatsapp/${businessId}?action=${action}`,
    { method: "POST", headers: { origin: requestOrigin }, body: JSON.stringify({ code: "fixture" }) },
  ), { params: Promise.resolve({ product, businessId }) });

  const completed = await post("retail", "test-retail", "signup");
  assert.equal(completed.status, 200);
  assert.equal(completed.headers.get("set-cookie"), null);
  assert.equal((await completed.json()).dashboardUrl, "/admin/products/retail/whatsapp?business=test-retail");
  assert.equal((await post("retail", "test-retail", "disconnect")).status, 200);
  assert.equal((await profileActions.refreshBusinessProfile("test-retail", "retail")).ok, true);
  assert.deepEqual(calls, [["signup", "test-retail", "fixture"], ["disconnect", "test-retail"], ["profile", "test-retail"]]);
  assert.equal((await post("retail", "test-eats", "signup")).status, 404);
  assert.equal((await post("motos", "phase6-motos", "disconnect")).status, 404);
  assert.equal((await post("retail", "test-retail", "disconnect", "https://other.example")).status, 403);
  assert.equal((await profileActions.refreshBusinessProfile("test-eats", "retail")).ok, false);
  local = true;
  assert.equal((await post("retail", "test-retail", "signup")).status, 403);
  local = false;
  process.env.MESSAGING_DATABASE = "firestore";
  assert.equal((await post("retail", "test-retail", "signup")).status, 503);
  process.env.MESSAGING_DATABASE = "postgres";
  include = false;
  assert.equal((await post("retail", "test-retail", "disconnect")).status, 404);
  include = true;
  role = "business";
  assert.equal((await post("retail", "test-retail", "signup")).status, 403);
  assert.equal((await profileActions.refreshBusinessProfile("test-retail", "retail")).ok, false);
  assert.equal(calls.length, 3);
  console.log("PASS Super Admin signup, disconnect and profile delegate to shared services; origin, local-runtime, test preference and cross-product guards reject invalid requests.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
