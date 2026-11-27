/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");

async function main() {
  loadEnvConfig(process.cwd());
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "staging target required");
  assert.doesNotMatch(`${url.hostname}${url.pathname}`, /prod|production|live/i, "production target forbidden");
  process.env.MESSAGING_DATABASE = "postgres";
  const { adminDb } = await import("../lib/firebase-admin.ts");
  adminDb.collection = () => { throw new Error("FIRESTORE_READ_FORBIDDEN"); };
  adminDb.runTransaction = () => { throw new Error("FIRESTORE_TRANSACTION_FORBIDDEN"); };
  const { getPostgresBusinessProfile } = await import("../lib/admin/postgres-directory.ts");
  const { getCatalog, getCatalogItem } = await import("../lib/messaging/services/catalog-service.ts");
  const { automationDashboard } = await import("../lib/automations/service.ts");
  const products = [
    { id: "test-retail", vertical: "retail", item: "tshirt", name: "T-Shirt" },
    { id: "test-eats", vertical: "eats", item: "chicken biriyani", name: "Chicken Biriyani" },
    { id: "test-motos", vertical: "motos", item: "creta_2021", name: "Hyundai Creta 2021" },
  ];
  for (const product of products) {
    const business = await getPostgresBusinessProfile(product.id);
    assert.equal(business?.vertical, product.vertical);
    assert.equal(business?.active, true);
    const catalog = await getCatalog(product.id, { available: true });
    assert.ok(catalog.some((item) => item.id === product.item && item.name === product.name), `${product.id} catalog fixture`);
    const dashboard = await automationDashboard(product.id);
    assert.equal(dashboard.vertical, product.vertical);
    assert.ok(dashboard.recipes.length > 0);
    assert.ok(dashboard.recipes.every((recipe) => recipe.vertical === product.vertical), `${product.id} automation isolation`);
    console.log(`PASS ${product.id} loads only ${product.vertical} automations and catalog from Postgres`);
  }
  assert.equal(await getCatalogItem("test-retail", "chicken biriyani"), null);
  assert.equal(await getCatalogItem("test-eats", "tshirt"), null);
  assert.equal(await getCatalogItem("test-motos", "tshirt"), null);
  console.log("PASS product catalog cross-tenant lookups are isolated; Firestore access blocked");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Product Postgres isolation test failed."); process.exitCode = 1; });
