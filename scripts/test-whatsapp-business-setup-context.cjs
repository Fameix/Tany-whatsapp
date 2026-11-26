/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  const { signIntegrationAccess } = await import("../lib/integration/access.ts");
  const { dashboardAccess, resolveDashboardSession } = await import("../lib/admin/dashboard-access.ts");
  const { signWhatsAppSetupSession, verifyWhatsAppSetupSession } = await import("../lib/admin/whatsapp-setup-session.ts");
  const secret = "context-test-secret-value-long-enough-for-hmac-2026";
  const adminToken = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 3600);
  const adminSession = await resolveDashboardSession(secret, adminToken);
  assert.deepEqual(adminSession, { role: "admin" });

  const setupToken = await signWhatsAppSetupSession(secret, "demo-retail");
  assert.equal(await verifyWhatsAppSetupSession(secret, setupToken, "demo-retail"), true);
  assert.equal(await verifyWhatsAppSetupSession(secret, setupToken, "demo-eats"), false, "setup context cannot be replayed for another business");
  assert.deepEqual(await resolveDashboardSession(secret, adminToken), { role: "admin" }, "business setup context must not replace the Super Admin dashboard session");

  const wrongBusinessToken = await signIntegrationAccess(secret, { kind: "business", businessId: "demo-eats" }, Date.now(), "tany-dashboard-v1", 3600);
  assert.equal(await dashboardAccess(secret, wrongBusinessToken, "demo-retail"), null, "a business session for another tenant cannot request the handoff");

  const button = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-account-actions.tsx", "utf8");
  const handoffRoute = fs.readFileSync("app/api/businesses/[businessId]/whatsapp/setup/handoff/route.ts", "utf8");
  const connectRoute = fs.readFileSync("app/api/dashboard/connect/route.ts", "utf8");
  const setupPage = fs.readFileSync("app/dashboard/messaging/setup/page.tsx", "utf8");
  const signupRoute = fs.readFileSync("app/api/dashboard/whatsapp-embedded-signup/route.ts", "utf8");
  assert.match(button, /api\/businesses\/\$\{encodeURIComponent\(businessId\)\}\/whatsapp\/setup\/handoff/);
  assert.match(handoffRoute, /createWorkspaceHandoff\(businessId\)/);
  assert.match(handoffRoute, /const next = businessWhatsAppSetupPath\(businessId\);/);
  assert.match(connectRoute, /whatsappSetupSessionCookieName/);
  assert.match(connectRoute, /response\.cookies\.set\(whatsappSetupSessionCookieName/);
  assert.match(setupPage, /verifyWhatsAppSetupSession\(secret, setupCredential, requestedBusinessId\)/);
  assert.match(signupRoute, /verifyWhatsAppSetupSession\(secret/);
  assert.match(signupRoute, /session\.businessId !== requestedBusinessId/);
  console.log("PASS business-scoped setup handoff, simultaneous Super Admin session preservation, and wrong-business rejection");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
