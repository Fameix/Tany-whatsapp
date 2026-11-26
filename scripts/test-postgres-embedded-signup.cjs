/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");

async function main() {
  loadEnvConfig(process.cwd());
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "requires explicit staging target");
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert.doesNotMatch(`${database.hostname}${database.pathname}`, /prod|production|live/i, "production target forbidden");
  process.env.MESSAGING_DATABASE = "postgres";
  process.env.META_GRAPH_VERSION = "v27.0";

  const suffix = randomUUID().replaceAll("-", "");
  const tenantA = `meta-signup-a-${suffix}`;
  const tenantB = `meta-signup-b-${suffix}`;
  const phoneNumberId = `9${[...suffix].map((character) => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const wabaId = `8${[...suffix].map((character) => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const client = new Client({ connectionString });
  await client.connect();
  let repository;
  try {
    const schema = await client.query("select to_regclass('public.messaging_businesses') as businesses, to_regclass('public.whatsapp_accounts') as accounts, to_regclass('public.whatsapp_phone_mappings') as mappings");
    assert.ok(schema.rows[0].businesses && schema.rows[0].accounts && schema.rows[0].mappings, "WhatsApp setup schema must already be applied in staging");
    await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status,products,settings) values($1,'Meta Signup Test A','retail','active','[]'::jsonb,'{}'::jsonb),($2,'Meta Signup Test B','retail','active','[]'::jsonb,'{}'::jsonb)", [tenantA, tenantB]);

    const { PostgresMessagingRepository } = await import("../lib/data/postgres-messaging-repository.ts");
    const { completeEmbeddedSignup } = await import("../lib/whatsapp/embedded-signup-service.ts");
    const { managedTokenSecretName } = await import("../lib/whatsapp/credentials.ts");
    const { SetupError } = await import("../lib/whatsapp/setup-service.ts");
    repository = new PostgresMessagingRepository();
    let exchanged = 0;
    let stored = 0;
    const dependencies = {
      exchangeCode: async (code) => {
        exchanged++;
        if (code === "expired-code-123") throw new SetupError("META_EXCHANGE_FAILED", "Meta authorization expired.", 422);
        return `server-only-fake-meta-token-${suffix}`;
      },
      appId: "1234567890123456",
      // Shape of Meta's debug_token for an Embedded Signup business (system-user) token.
      debugToken: async () => ({ appId: "1234567890123456", isValid: true, type: "SYSTEM_USER", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"], wabaIds: [wabaId] }),
      graph: async (path) => {
        // Real Meta: a system-user token has no owned_whatsapp_business_accounts edge (#100).
        if (path.startsWith("me/owned_whatsapp_business_accounts")) throw new SetupError("META_VALIDATION_FAILED", "Tried accessing nonexisting field (owned_whatsapp_business_accounts)", 422);
        if (path === `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`) return { data: [{ id: phoneNumberId, display_phone_number: "+14155550123", verified_name: "Tany Staging Signup" }] };
        if (path === `${wabaId}/subscribed_apps`) return {};
        throw new Error(`Unexpected Meta Graph path: ${path}`);
      },
      storeToken: async (businessId, token) => {
        assert.equal(token, `server-only-fake-meta-token-${suffix}`);
        stored++;
        return managedTokenSecretName(businessId);
      },
      validateSetup: async (businessId) => {
        const claim = await repository.claimWhatsAppSetupTest(businessId);
        await repository.finishWhatsAppSetupTest(businessId, claim.revision, true, "Staging provider validation passed.", "live");
      },
      credentialAvailable: async (_businessId, secretReference) => secretReference === managedTokenSecretName(tenantA),
    };

    const connected = await completeEmbeddedSignup(tenantA, { code: "valid-code-123", wabaId, phoneNumberId }, dependencies);
    assert.equal(connected.status, "connected");
    assert.equal(connected.phoneNumberId, phoneNumberId);
    assert.equal(connected.wabaId, wabaId);
    assert.equal(connected.displayPhone, "+14155550123");
    assert.equal(connected.tokenSecretName, managedTokenSecretName(tenantA));
    const owner = await client.query("select b.legacy_business_id,a.status,a.phone_number_id,a.waba_id,a.display_phone,a.token_secret_name from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id where a.phone_number_id=$1", [phoneNumberId]);
    assert.equal(owner.rowCount, 1);
    assert.deepEqual(owner.rows[0], { legacy_business_id: tenantA, status: "connected", phone_number_id: phoneNumberId, waba_id: wabaId, display_phone: "+14155550123", token_secret_name: managedTokenSecretName(tenantA) });
    assert.equal(JSON.stringify(owner.rows[0]).includes(`server-only-fake-meta-token-${suffix}`), false, "raw token must not be persisted");
    console.log("PASS successful Meta signup persisted connected account and secret reference in staging Postgres");

    const storedBeforeDuplicate = stored;
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId }, dependencies), (error) => error && error.code === "PHONE_ALREADY_CONNECTED");
    assert.equal(stored, storedBeforeDuplicate, "duplicate mapping must be rejected before secret storage");
    assert.equal((await repository.getWhatsAppAccount(tenantB)), null);
    console.log("PASS duplicate phone mapping rejected without a second tenant mapping");

    const accountCountBeforeInvalid = Number((await client.query("select count(*)::int as count from whatsapp_accounts")).rows[0].count);
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "bad" }, dependencies), (error) => error && error.code === "INVALID_SIGNUP_RESPONSE");
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "expired-code-123" }, dependencies), (error) => error && error.code === "META_EXCHANGE_FAILED");
    assert.equal(Number((await client.query("select count(*)::int as count from whatsapp_accounts")).rows[0].count), accountCountBeforeInvalid);
    console.log("PASS malformed and expired Meta authorization codes rejected with no Postgres account write");

    const exchangesBeforeConnectedRetry = exchanged;
    await assert.rejects(() => completeEmbeddedSignup(tenantA, { code: "valid-code-123", wabaId, phoneNumberId }, dependencies), (error) => error && error.code === "ALREADY_CONNECTED");
    assert.equal(exchanged, exchangesBeforeConnectedRetry, "connected business should be redirected before a second Meta exchange");
    console.log("PASS already connected business rejected before exchanging a new code");

    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId: "777777777777", phoneNumberId }, dependencies), (error) => error && error.code === "META_ACCOUNT_SELECTION_REQUIRED");
    assert.equal(await repository.getWhatsAppAccount(tenantB), null);
    const mappedTenant = await client.query("select b.legacy_business_id from whatsapp_phone_mappings p join messaging_businesses b on b.id=p.messaging_business_id where p.phone_number_id=$1", [phoneNumberId]);
    assert.deepEqual(mappedTenant.rows, [{ legacy_business_id: tenantA }]);
    console.log("PASS foreign Meta asset hint cannot cross tenant boundary or remap the connected number");

    const tokenInfo = (overrides) => ({ ...dependencies, debugToken: async () => ({ appId: "1234567890123456", isValid: true, type: "SYSTEM_USER", scopes: ["whatsapp_business_management"], wabaIds: [wabaId], ...overrides }) });
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId }, tokenInfo({ appId: "9999999999999999" })), (error) => error && error.code === "META_VALIDATION_FAILED");
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId }, tokenInfo({ isValid: false })), (error) => error && error.code === "META_VALIDATION_FAILED");
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId }, tokenInfo({ scopes: ["public_profile"] })), (error) => error && error.code === "META_PERMISSION_REQUIRED");
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123" }, tokenInfo({ wabaIds: [] })), (error) => error && error.code === "META_ACCOUNT_SELECTION_REQUIRED");
    assert.equal(await repository.getWhatsAppAccount(tenantB), null, "rejected tokens never write an account");
    console.log("PASS WABA discovery uses debug_token granular scopes; wrong-app, invalid, unpermitted and asset-less tokens rejected");

    // Real debug_token parser against Meta's response shape (fetch stubbed; no network).
    process.env.NEXT_PUBLIC_META_APP_ID = "1234567890123456";
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = "123456789012345";
    process.env.META_APP_SECRET = "test-app-secret";
    const realFetch = globalThis.fetch;
    const debugCalls = [];
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith("https://graph.facebook.com/")) return realFetch(url, init);
      debugCalls.push({ url: String(url), authorization: init?.headers?.Authorization });
      return new Response(JSON.stringify({ data: { app_id: "1234567890123456", type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["whatsapp_business_management", "whatsapp_business_messaging", "public_profile"], granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["777777777777"] }, { scope: "whatsapp_business_messaging", target_ids: ["777777777777"] }] } }), { status: 200 });
    };
    try {
      const withoutDebug = { ...dependencies };
      delete withoutDebug.debugToken;
      delete withoutDebug.appId;
      await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId }, withoutDebug), (error) => error && error.code === "META_ACCOUNT_SELECTION_REQUIRED", "granted WABA differs from hint: tenant boundary holds");
    } finally { globalThis.fetch = realFetch; }
    assert.equal(debugCalls.length, 1);
    assert.match(debugCalls[0].url, /\/debug_token\?input_token=server-only-fake-meta-token-/);
    assert.equal(debugCalls[0].authorization, "Bearer 1234567890123456|test-app-secret", "debug_token uses the app access token");
    console.log("PASS real debug_token parser reads granular_scopes target_ids with the configured app token");

    // Secret Manager write failure (e.g. API disabled in the resolved project) is a specific,
    // logged 503 and never activates the account.
    const { CredentialStorageError } = await import("../lib/whatsapp/credentials.ts");
    const otherPhone = String(Date.now()).slice(-12).padStart(12, "4");
    const storageFails = { ...dependencies,
      debugToken: async () => ({ appId: "1234567890123456", isValid: true, type: "SYSTEM_USER", scopes: ["whatsapp_business_management"], wabaIds: [wabaId] }),
      graph: async (path) => path.endsWith("/phone_numbers?fields=id,display_phone_number,verified_name&limit=100") ? { data: [{ id: otherPhone, display_phone_number: "+14155550999", verified_name: "Storage Failure" }] } : dependencies.graph(path),
      storeToken: async () => { throw new CredentialStorageError("create-secret", "refynlabs-master", 403, "PERMISSION_DENIED"); },
      validateSetup: async () => { throw new Error("live test must not run without a stored credential"); },
    };
    await assert.rejects(() => completeEmbeddedSignup(tenantB, { code: "valid-code-123", wabaId, phoneNumberId: otherPhone }, storageFails), (error) => error && error.code === "SECRET_STORAGE_UNAVAILABLE" && error.status === 503);
    const afterStorageFailure = await repository.getWhatsAppAccount(tenantB);
    assert.notEqual(afterStorageFailure?.status, "connected", "storage failure never activates the account");
    console.log("PASS Secret Manager write failure returns SECRET_STORAGE_UNAVAILABLE (503) and leaves the account unactivated");
  } finally {
    await client.query("delete from whatsapp_phone_mappings where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]).catch(() => {});
    await client.query("delete from whatsapp_accounts where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]).catch(() => {});
    await client.query("delete from messaging_businesses where legacy_business_id in ($1,$2)", [tenantA, tenantB]).catch(() => {});
    await client.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Postgres Meta signup test failed"); process.exitCode = 1; });
