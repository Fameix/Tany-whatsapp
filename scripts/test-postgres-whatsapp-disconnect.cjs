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
  const target = new URL(connectionString);
  assert.doesNotMatch(`${target.hostname}${target.pathname}`, /prod|production|live/i, "production target forbidden");
  process.env.MESSAGING_DATABASE = "postgres";

  const suffix = randomUUID().replaceAll("-", "");
  const tenantA = `disconnect-a-${suffix}`;
  const tenantB = `disconnect-b-${suffix}`;
  const phoneA = `7${[...suffix].map((character) => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const phoneB = `6${[...suffix].map((character) => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const waba = `8${[...suffix].map((character) => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const catalogId = `disconnect-test-${suffix}`;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const schema = await client.query("select to_regclass('public.whatsapp_accounts') as accounts, to_regclass('public.whatsapp_phone_mappings') as mappings, to_regclass('public.messaging_catalog_items') as catalog");
    assert.ok(schema.rows[0].accounts && schema.rows[0].mappings && schema.rows[0].catalog, "Messaging schema must already exist in staging");
    await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status,products,settings) values($1,'Disconnect Test A','retail','active','[]'::jsonb,'{}'::jsonb),($2,'Disconnect Test B','eats','active','[]'::jsonb,'{}'::jsonb)", [tenantA, tenantB]);
    const { PostgresMessagingRepository } = await import("../lib/data/postgres-messaging-repository.ts");
    const repository = new PostgresMessagingRepository();
    const now = new Date();
    await repository.mirrorAccount({ id: tenantA, businessId: tenantA, vertical: "retail", setupType: "existing", phoneNumberId: phoneA, wabaId: waba, displayPhone: "+14155550111", displayName: "Disconnect Test A", tokenSecretName: "TANY_TEST_SECRET_A", status: "connected", testPassed: true, validationMode: "live", testedAt: now, setupStep: 5, revision: 7 });
    await repository.mirrorAccount({ id: tenantB, businessId: tenantB, vertical: "eats", setupType: "existing", phoneNumberId: phoneB, wabaId: `${Number(waba) + 1}`, displayPhone: "+14155550112", displayName: "Disconnect Test B", tokenSecretName: "TANY_TEST_SECRET_B", status: "connected", testPassed: true, validationMode: "live", testedAt: now, setupStep: 5, revision: 3 });
    await repository.saveCatalogItem(tenantA, catalogId, { type: "product", name: "Keep me", description: "Unrelated data", price: 1, available: true, category: "test", metadata: {} });

    await repository.disconnectWhatsAppSetup(tenantA);
    const cleared = await client.query("select a.id,a.status,a.waba_id,a.phone_number_id,a.display_phone,a.display_name,a.token_secret_name,a.created_at,a.tested_at,a.test_message,b.whatsapp_phone_number_id from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id where b.legacy_business_id=$1", [tenantA]);
    assert.equal(cleared.rowCount, 1, "account history row must be retained");
    assert.equal(cleared.rows[0].status, "disconnected");
    assert.equal(cleared.rows[0].waba_id, null);
    assert.equal(cleared.rows[0].phone_number_id, null);
    assert.equal(cleared.rows[0].display_phone, null);
    assert.equal(cleared.rows[0].display_name, null);
    assert.equal(cleared.rows[0].token_secret_name, "");
    assert.equal(cleared.rows[0].whatsapp_phone_number_id, null);
    assert.ok(cleared.rows[0].created_at instanceof Date, "account creation history remains");
    assert.ok(cleared.rows[0].tested_at instanceof Date, "prior connection check history remains");
    assert.equal((await client.query("select 1 from whatsapp_phone_mappings where phone_number_id=$1", [phoneA])).rowCount, 0);
    assert.ok(await repository.getCatalogItem(tenantA, catalogId), "unrelated tenant data must remain");
    console.log("PASS disconnect clears active account fields and phone mappings while retaining account/test history");

    const other = await client.query("select a.status,a.phone_number_id,a.waba_id,a.token_secret_name,b.whatsapp_phone_number_id from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id where b.legacy_business_id=$1", [tenantB]);
    assert.deepEqual(other.rows[0], { status: "connected", phone_number_id: phoneB, waba_id: `${Number(waba) + 1}`, token_secret_name: "TANY_TEST_SECRET_B", whatsapp_phone_number_id: phoneB });
    assert.equal((await client.query("select 1 from whatsapp_phone_mappings where phone_number_id=$1 and messaging_business_id=(select id from messaging_businesses where legacy_business_id=$2)", [phoneB, tenantB])).rowCount, 1);
    console.log("PASS disconnect is tenant-scoped and leaves the other business account and mapping unchanged");

    await repository.disconnectWhatsAppSetup(tenantA);
    assert.equal((await client.query("select status from whatsapp_accounts where messaging_business_id=(select id from messaging_businesses where legacy_business_id=$1)", [tenantA])).rows[0].status, "disconnected");
    await assert.rejects(() => repository.disconnectWhatsAppSetup(`missing-${suffix}`), /POSTGRES_TENANT_UNMAPPED/);
    console.log("PASS repeated disconnect is safe and unmapped tenant cannot disconnect an account");

    await repository.saveWhatsAppSetup({ businessId: tenantA, vertical: "retail", setupType: "existing", displayName: "Reconnect Test A", displayPhone: "+14155550111", businessName: "", phoneNumberId: phoneA, wabaId: waba, tokenSecretName: "TANY_TEST_SECRET_A" });
    const remapped = await client.query("select b.legacy_business_id,a.status,a.phone_number_id from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id join whatsapp_phone_mappings p on p.messaging_business_id=b.id and p.phone_number_id=a.phone_number_id where b.legacy_business_id=$1", [tenantA]);
    assert.deepEqual(remapped.rows, [{ legacy_business_id: tenantA, status: "pending", phone_number_id: phoneA }]);
    assert.equal((await client.query("select count(*)::int as count from whatsapp_phone_mappings where phone_number_id=$1", [phoneA])).rows[0].count, 1);
    console.log("PASS disconnected phone number can be connected again to the same tenant");

    await repository.disconnectWhatsAppSetup(tenantA);
    await repository.disconnectWhatsAppSetup(tenantB);
    await repository.saveWhatsAppSetup({ businessId: tenantB, vertical: "eats", setupType: "existing", displayName: "Reconnect Test B", displayPhone: "+14155550111", businessName: "", phoneNumberId: phoneA, wabaId: waba, tokenSecretName: "TANY_TEST_SECRET_B" });
    const moved = await client.query("select b.legacy_business_id,b.vertical,a.phone_number_id from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id join whatsapp_phone_mappings p on p.messaging_business_id=b.id and p.phone_number_id=a.phone_number_id where p.phone_number_id=$1", [phoneA]);
    assert.deepEqual(moved.rows, [{ legacy_business_id: tenantB, vertical: "eats", phone_number_id: phoneA }]);
    console.log("PASS after disconnect the same phone can be remapped from Retail to a different Eats tenant");
  } finally {
    await client.query("delete from whatsapp_phone_mappings where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]).catch(() => {});
    await client.query("delete from whatsapp_accounts where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]).catch(() => {});
    await client.query("delete from messaging_catalog_items where id=$1", [catalogId]).catch(() => {});
    await client.query("delete from messaging_businesses where legacy_business_id in ($1,$2)", [tenantA, tenantB]).catch(() => {});
    await client.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Postgres disconnect test failed"); process.exitCode = 1; });
