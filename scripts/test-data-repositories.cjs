/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness } = require("./messaging-test-helpers.cjs");

class FakeD1 {
  constructor() { this.writes = []; this.failWrites = false; }
  prepare(query) {
    // The statement callbacks intentionally close over this test-double instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this;
    const statement = {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() {
        if (query.includes("FROM businesses")) return {
          id: "eats-business", name: "Eats", vertical: "eats", active: 1,
          products_json: '["eats"]', whatsapp_phone_number_id: "phone-1",
        };
        if (query.includes("FROM subscriptions")) return {
          business_id: "eats-business", plan: "pro", status: "active", started_at: 1, expires_at: 2,
        };
        if (query.includes("FROM entitlements")) return {
          business_id: "eats-business", whatsapp_automation: 1, campaigns: 0, advanced_analytics: 0, ai_assistant: 0,
        };
        return null;
      },
      async all() { return { results: [] }; },
      async run() { if (db.failWrites) throw new Error("shadow unavailable"); db.writes.push({ query, values: this.values }); return { success: true }; },
    };
    return statement;
  }
}

async function main() {
  const h = createHarness({ seedFixtures: false });
  const { D1MessagingRepository } = h.load("lib/data/d1-repository.ts");
  const { databaseMode, repositoryFor, shadowWrite } = h.load("lib/data/repository.ts");
  const d1 = new FakeD1();
  const repository = new D1MessagingRepository(d1);

  assert.deepEqual(await repository.getBusiness("eats-business"), {
    id: "eats-business", name: "Eats", vertical: "eats", active: true,
    products: ["eats"], whatsappPhoneNumberId: "phone-1", settings: {},
  });
  h.seed("businesses/phone-lookup", {
    name: "Repository Eats", vertical: "eats", active: true, whatsappPhoneNumberId: "phone-lookup",
  });
  const businessLoader = h.load("lib/messaging/business.ts");
  assert.deepEqual(await businessLoader.findBusinessByPhoneNumberId("phone-lookup"), {
    id: "phone-lookup", name: "Repository Eats", vertical: "eats", active: true, whatsappPhoneNumberId: "phone-lookup",
  }, "business lookup goes through the repository");
  assert.deepEqual(await repository.getSubscriptionAndEntitlement("eats-business"), {
    subscription: { businessId: "eats-business", plan: "pro", status: "active", startedAt: 1, expiresAt: 2 },
    entitlement: { businessId: "eats-business", whatsappAutomation: true, campaigns: false, advancedAnalytics: false, aiAssistant: false },
  });
  await repository.writeSubscriptionEntitlement({
    businessId: "eats-business", plan: "pro", status: "active", startedAt: 1, expiresAt: 2,
    whatsappAutomation: true, campaigns: false, advancedAnalytics: false, aiAssistant: false,
  });
  assert.equal(d1.writes.length, 2, "D1 writes subscription and entitlement together");
  d1.writes.length = 0;
  assert.equal(databaseMode("firestore"), "firestore");
  assert.equal(databaseMode("d1"), "d1");
  assert.equal(databaseMode("dual"), "dual");
  assert.equal(databaseMode("not-a-mode"), "firestore");
  await assert.rejects(() => repositoryFor("d1"), /D1 binding is required/, "D1 mode fails clearly without a binding");

  await shadowWrite("firestore", d1, "automations", { id: "ignored", businessId: "eats-business" });
  assert.equal(d1.writes.length, 0, "Firestore mode must not shadow-write");
  await shadowWrite("dual", d1, "automations", { id: "automation-1", businessId: "eats-business", name: "Welcome" });
  assert.equal(d1.writes.length, 0, "invalid automation shadow writes are rejected without touching primary state");
  await shadowWrite("dual", d1, "automations", { id: "automation-1", businessId: "eats-business", product: "eats", status: "draft", name: "Welcome" });
  assert.equal(d1.writes.length, 1, "dual mode writes a D1 shadow copy");
  assert.match(d1.writes[0].query, /INSERT INTO automations/);
  assert.deepEqual(d1.writes[0].values.slice(0, 2), ["automation-1", "eats-business"]);
  d1.failWrites = true;
  await shadowWrite("dual", d1, "automations", { id: "automation-2", businessId: "eats-business", product: "eats", status: "draft" });
  assert.equal(d1.writes.length, 1, "a shadow failure cannot fail the primary request");
  await assert.rejects(() => repository.upsertTenantRow("businesses", { id: "bad", businessId: "eats-business" }), /Unsupported tenant table/);
  console.log("PASS: D1 repository mapping, mode selection, tenant allow-list, and dual shadow writes.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
