/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");

async function main() {
  loadEnvConfig(process.cwd());
  const raw = process.env.DATABASE_URL;
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "requires explicit staging target");
  assert.ok(raw, "DATABASE_URL required");
  const url = new URL(raw);
  assert.doesNotMatch(`${url.hostname}${url.pathname}`, /prod|production|live/i, "production target forbidden");
  process.env.MESSAGING_DATABASE = "postgres";
  const client = new Client({ connectionString: raw });
  await client.connect();
  const schema = await client.query("select to_regclass('public.messaging_subscriptions') as subscriptions");
  assert.ok(schema.rows[0].subscriptions, "Phase 5 subscription schema must exist in staging");
  const businessId = `phase5b-test-${randomUUID()}`;
  const repositoryModule = await import("../lib/data/postgres-messaging-repository.ts");
  const entitlementModule = await import("../lib/subscriptions/entitlements.ts");
  const repository = new repositoryModule.PostgresMessagingRepository();
  const now = Date.now();
  try {
    await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status) values($1,$2,'retail','active')", [businessId, "Phase 5B disposable test"]);
    const write = (values) => repository.writeSubscriptionEntitlement({
      businessId, plan: values.plan ?? "pro", status: values.status ?? "active",
      startedAt: values.startedAt ?? now - 1000, expiresAt: values.expiresAt ?? now + 60000,
      whatsappAutomation: values.whatsappAutomation ?? true, campaigns: false, advancedAnalytics: false, aiAssistant: false,
    });
    await entitlementModule.assignDemoSubscription(businessId, "pro");
    let records = await repository.getSubscriptionAndEntitlement(businessId);
    assert.equal(records.subscription.businessId, businessId);
    assert.equal(records.entitlement.businessId, businessId);
    process.env.MESSAGING_DATABASE = "dual-write";
    assert.equal((await entitlementModule.resolveEntitlements(businessId)).whatsappAutomation, true);
    console.log("PASS postgres write and dual-write Postgres entitlement read allowed");

    await write({ plan: "basic", whatsappAutomation: false });
    assert.equal((await entitlementModule.resolveEntitlements(businessId, now)).whatsappAutomation, false);
    console.log("PASS Postgres denied entitlement");

    await write({ status: "cancelled" });
    assert.equal((await entitlementModule.resolveEntitlements(businessId, now)).whatsappAutomation, false);
    await write({ expiresAt: now - 1 });
    assert.equal((await entitlementModule.resolveEntitlements(businessId, now)).whatsappAutomation, false);
    console.log("PASS inactive and expired subscriptions denied");

    const otherTenant = `phase5b-unmapped-${randomUUID()}`;
    await assert.rejects(() => repository.getSubscriptionAndEntitlement(otherTenant), /POSTGRES_TENANT_UNMAPPED/);
    process.env.MESSAGING_DATABASE = "postgres";
    await assert.rejects(() => entitlementModule.resolveEntitlements(otherTenant, now), /POSTGRES_TENANT_UNMAPPED/);
    process.env.MESSAGING_DATABASE = "dual-write";
    await assert.rejects(() => entitlementModule.resolveEntitlements(otherTenant, now), /POSTGRES_TENANT_UNMAPPED/);
    console.log("PASS Postgres tenant isolation and no Firestore fallback");
  } finally {
    await client.query("delete from messaging_subscriptions where legacy_business_id=$1", [businessId]);
    await client.query("delete from messaging_businesses where legacy_business_id=$1", [businessId]);
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
