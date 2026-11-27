/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHarness } = require("./messaging-test-helpers.cjs");

const origin = "https://dashboard.test";
const secret = "disconnect-action-secret-long-enough-for-hmac-2026";

async function main() {
  process.env.MESSAGING_SERVICE_SECRET = secret;
  const h = createHarness();
  const { NextRequest } = require("next/server");
  const { signIntegrationAccess } = h.load("lib/integration/access.ts");
  const { dashboardSessionCookieName } = h.load("lib/admin/dashboard-cookie.ts");
  const setupService = h.load("lib/whatsapp/setup-service.ts");
  const clientConnection = h.load("lib/whatsapp/client-connection.ts");
  const { requestWhatsAppDisconnect } = h.load("lib/whatsapp/disconnect-client.ts");

  const adminToken = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1", 3600);
  const retailToken = await signIntegrationAccess(secret, { kind: "business", businessId: "demo-retail" }, Date.now(), "tany-dashboard-v1", 3600);

  // Backend: stub the tenant-scoped disconnect service (its Postgres behavior is covered by
  // test:postgres-whatsapp-disconnect) and exercise the real route authorization.
  const disconnected = [];
  let failure = null;
  setupService.disconnectWhatsAppSetup = async (businessId) => { if (failure) throw failure; disconnected.push(businessId); };
  clientConnection.getClientWhatsAppConnection = async () => ({ status: "disconnected", displayName: "", displayPhone: "", catalogConnected: false, health: "not_available", setupMessage: "" });
  const route = h.load("app/api/dashboard/whatsapp-connection/route.ts");
  const post = (token, query = "") => route.POST(new NextRequest(`${origin}/api/dashboard/whatsapp-connection${query}`, {
    method: "POST", headers: { origin, "content-type": "application/json", cookie: `${dashboardSessionCookieName}=${token}` }, body: JSON.stringify({ action: "disconnect" }),
  }));

  // Root cause regression: a Super Admin on the business page was always rejected (401).
  const admin = await post(adminToken, "?businessId=demo-retail");
  assert.equal(admin.status, 200, "Super Admin disconnect for the named business succeeds");
  assert.deepEqual(disconnected, ["demo-retail"]);
  assert.equal((await post(adminToken)).status, 401, "Super Admin must name the business explicitly");
  assert.equal((await post(retailToken, "?businessId=demo-retail")).status, 200);
  assert.equal((await post(retailToken)).status, 200, "a business session defaults to its own business");
  const mismatch = await post(retailToken, "?businessId=demo-eats");
  assert.equal(mismatch.status, 403, "a business session cannot disconnect another business");
  assert.equal((await mismatch.json()).code, "BUSINESS_MISMATCH");
  assert.deepEqual(disconnected, ["demo-retail", "demo-retail", "demo-retail"], "only the authorized business was disconnected");
  failure = new setupService.SetupError("NOT_FOUND", "Account unavailable.", 404);
  const missing = await post(retailToken);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).message, /no WhatsApp connection to disconnect/);
  failure = new Error("database down");
  assert.equal((await post(retailToken)).status, 503);
  failure = null;
  console.log("PASS disconnect API: Super Admin with explicit business, own-business session, cross-tenant rejected, errors surfaced");

  // Client request: confirm calls the API with the business; success/failure results.
  const calls = [];
  const fetcher = (status, body) => async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); };
  assert.deepEqual(await requestWhatsAppDisconnect("demo-retail", fetcher(200, { ok: true })), { ok: true });
  assert.equal(calls[0].url, "/api/dashboard/whatsapp-connection?businessId=demo-retail");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: "disconnect" });
  assert.deepEqual(await requestWhatsAppDisconnect("demo-retail", fetcher(401, { message: "Open WhatsApp from your Tany account." })), { ok: false, message: "Open WhatsApp from your Tany account." });
  assert.deepEqual(await requestWhatsAppDisconnect("demo-retail", fetcher(503, {})), { ok: false, message: "Could not disconnect WhatsApp. Please try again." });
  const offline = await requestWhatsAppDisconnect("demo-retail", async () => { throw new TypeError("fetch failed"); });
  assert.equal(offline.ok, false);
  assert.match(offline.message, /Could not reach Tany/);

  // Component wiring: confirm -> disconnect(); success -> Not connected + refresh; failure -> alert in dialog.
  const component = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-account-actions.tsx", "utf8");
  assert.match(component, /<AlertDialogAction disabled=\{pending\} onClick=\{\(event\) => \{ event\.preventDefault\(\); void disconnect\(\); \}\}>/, "confirm button triggers disconnect");
  assert.match(component, /const result = await requestWhatsAppDisconnect\(businessId, fetch, disconnectEndpoint\);/);
  const success = component.slice(component.indexOf("if (!result.ok)"), component.indexOf("router.refresh();") + "router.refresh();".length);
  for (const step of ['setDisconnectError(result.message);', 'return;', 'setStatus("Not connected");', "setHasConfiguredPhone(false);", "setConfirmOpen(false);", "router.refresh();"])
    assert.ok(success.includes(step), `disconnect flow includes ${step}`);
  assert.ok(success.indexOf("return;") < success.indexOf('setStatus("Not connected")'), "a failed disconnect never shows Not connected");
  const dialog = component.slice(component.indexOf("<AlertDialogContent>"), component.indexOf("</AlertDialogContent>"));
  assert.match(dialog, /\{disconnectError && <p role="alert"/, "backend failure is shown inside the open dialog");
  assert.match(component, /status\.includes\("unverified"\) \? "Continue setup" : status === "Error" \|\| status === "Disconnected" \? "Reconnect WhatsApp" : "Connect WhatsApp"/);
  assert.match(component, /!connected && \(stagingHref/, "Not connected shows the Connect WhatsApp CTA");
  const setupScreen = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-connection.tsx", "utf8");
  assert.match(setupScreen, /\/api\/dashboard\/whatsapp-connection\?businessId=\$\{encodeURIComponent\(businessId\)\}/, "setup-page disconnect also names the business");
  // Explicit disconnect survives the phone and mapping being cleared.
  assert.match(fs.readFileSync("lib/admin/postgres-directory.ts", "utf8"), /postgresWhatsAppStatus/);
  const status = fs.readFileSync("lib/admin/postgres-whatsapp-status.ts", "utf8");
  assert.match(status, /when a\.status = 'disconnected' then 'Disconnected'/);
  assert.match(status, /m\.whatsapp_account_id = a\.id/);
  console.log("PASS disconnect UI: confirm triggers the API, success shows Not connected + refreshes, failure stays in the dialog with the error");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
