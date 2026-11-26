/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const fixtures = require("./fixtures/business-data.json");

const tenants = [
  { businessId: "test-retail", name: "Test Retail", vertical: "retail" },
  { businessId: "test-eats", name: "Test Eats", vertical: "eats" },
  { businessId: "test-motos", name: "Test Motos", vertical: "motos" },
];

async function main() {
  loadEnvConfig(process.cwd());
  const raw = process.env.DATABASE_URL ?? "";
  const target = new URL(raw);
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging" || /prod|production|live/i.test(`${target.hostname}${target.pathname}`))
    throw new Error("Refusing to provision product test tenants: staging Postgres target required.");
  process.env.MESSAGING_DATABASE = "postgres";
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun) {
    const client = new Client({ connectionString: raw });
    await client.connect();
    try {
      await client.query("update messaging_businesses b set whatsapp_phone_number_id=null where b.legacy_business_id=any($1::text[]) and b.whatsapp_phone_number_id='' and not exists (select 1 from whatsapp_accounts a where a.messaging_business_id=b.id and a.status='connected')", [tenants.map(({ businessId }) => businessId)]);
    } finally { await client.end(); }
  }
  const { PostgresMessagingRepository } = await import("../lib/data/postgres-messaging-repository.ts");
  const { assignDemoSubscription } = await import("../lib/subscriptions/entitlements.ts");
  const repository = new PostgresMessagingRepository();
  const report = { target: "staging", dryRun, businessesCreated: [], businessesExisting: [], catalogsCreated: 0, catalogsExisting: 0, subscriptionsCreated: [], subscriptionsExisting: [] };

  for (const tenant of tenants) {
    let profile = null;
    try { profile = await repository.getBusiness(tenant.businessId); }
    catch (error) { if (!String(error?.message).includes("POSTGRES_TENANT_UNMAPPED")) throw error; }
    if (profile) {
      if (profile.vertical !== tenant.vertical)
        throw new Error(`Refusing to modify ${tenant.businessId}: existing product is ${profile.vertical}.`);
      if (!profile.active)
        throw new Error(`Refusing to activate ${tenant.businessId}: existing staging business is inactive.`);
      report.businessesExisting.push(tenant.businessId);
    } else {
      report.businessesCreated.push(tenant.businessId);
      if (!dryRun) await repository.createBusinessProfile({
        businessId: tenant.businessId, name: tenant.name, vertical: tenant.vertical,
        active: true, products: [tenant.vertical], whatsappPhoneNumberId: null, settings: fixtures[tenant.vertical].settings,
      });
    }

    for (const item of fixtures[tenant.vertical].catalog) {
      const existing = dryRun && !profile ? null : await repository.getCatalogItem(tenant.businessId, item.id);
      if (existing) { report.catalogsExisting++; continue; }
      report.catalogsCreated++;
      if (!dryRun) await repository.saveCatalogItem(tenant.businessId, item.id, {
        type: item.type, name: item.name, description: item.description ?? "", price: item.price,
        available: item.available, category: item.category ?? null, metadata: item.metadata ?? {},
      });
    }

    if (profile) {
      const existing = await repository.getSubscriptionAndEntitlement(tenant.businessId);
      if (existing.subscription && existing.entitlement) report.subscriptionsExisting.push(tenant.businessId);
      else {
        report.subscriptionsCreated.push(tenant.businessId);
        if (!dryRun) await assignDemoSubscription(tenant.businessId, "pro", "active", 365);
      }
    } else {
      report.subscriptionsCreated.push(tenant.businessId);
      if (!dryRun) await assignDemoSubscription(tenant.businessId, "pro", "active", 365);
    }
  }
  console.log(JSON.stringify(report));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Product test tenant provisioning failed."); process.exitCode = 1; });
