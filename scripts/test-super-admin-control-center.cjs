/* eslint-disable @typescript-eslint/no-require-imports */
// Super Admin control center: the 12-product registry, tenant classification, product-scoped
// metrics that exclude test/demo/migration tenants, and Postgres-only data. Staging is read only.
const fs = require("node:fs");

// Isolate fixtures in session-local tables that shadow the real schema.
async function checkOverview(assert, getOperationalOverview, listProductTenants, listProductRecords) {
  const { Client } = require("pg");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    for (const table of ["messaging_businesses", "whatsapp_accounts", "whatsapp_messages",
      "whatsapp_message_events", "whatsapp_conversations", "whatsapp_templates", "whatsapp_contacts",
      "whatsapp_webhook_events", "whatsapp_phone_mappings", "automation_definitions", "automation_runs", "messaging_runtime_records", "messaging_catalog_items"]) {
      await client.query(`create temp table ${table} (like public.${table} including defaults) on commit drop`);
    }
    const now = Date.parse("2026-11-27T12:00:00Z");
    const at = new Date(now - 60_000);
    const yesterday = new Date(now - 86_460_000);
    const fixtures = [
      ["retail", "retail-live", {}, 2], ["eats", "eats-live", {}, 3], ["motos", "motos-live", {}, 1],
      ["retail", "test-retail", {}, 9], ["eats", "test-eats", {}, 6], ["motos", "test-motos", {}, 4],
      ["eats", "demo-eats", {}, 9], ["motos", "phase6-motos", {}, 9],
      ["retail", "marked-tenant", { tenantKind: "migration" }, 9], ["ecom", "ecom-tenant", {}, 9],
    ];
    for (const [product, slug, settings, count] of fixtures) {
      const { rows: [{ id }] } = await client.query(
        "insert into messaging_businesses(legacy_business_id,name,vertical,settings) values ($1,$1,$2,$3) returning id",
        [slug, product, settings],
      );
      await client.query("insert into whatsapp_accounts(messaging_business_id,phone_number_id,token_secret_name,status,test_passed,validation_mode,tested_at,activated_at) values ($1,$2,'fixture','connected',true,'live',$3,$3)", [id, slug, at]);
      await client.query("insert into whatsapp_phone_mappings(phone_number_id,messaging_business_id,whatsapp_account_id) select phone_number_id,messaging_business_id,id from whatsapp_accounts where messaging_business_id=$1", [id]);
      await client.query("insert into automation_definitions(id,messaging_business_id,product,status) values ($1,$2,$3,'active')", [slug, id, product]);
      await client.query("insert into automation_runs(id,messaging_business_id,automation_id,trigger,started_at) values ($1,$2,$1,'fixture',$3)", [slug, id, at]);
      await client.query("insert into whatsapp_templates(messaging_business_id,name,language,status,updated_at) values ($1,'Fixture','en','approved',$2)", [id, at]);
      await client.query("insert into whatsapp_webhook_events(messaging_business_id,meta_event_id,processing_status,received_at) values ($1,$2,'failed',$3)", [id, slug, at]);
      await client.query("insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data,updated_at) values ($1,'campaigns','running','{\"status\":\"running\"}',$2), ($1,'campaigns','draft','{\"status\":\"draft\"}',$2)", [id, at]);
      await client.query("insert into whatsapp_contacts(messaging_business_id,phone_enc,phone_hash) select $1, 'fixture', n::text from generate_series(1,$2) n", [id, count]);
      await client.query("insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data) select $1,$2,'domain-' || n,$3 from generate_series(1,$4) n", [
        id, product === "motos" ? "bookings" : "orders",
        product === "motos" ? { serviceId: "test_drive", status: "completed" } : { status: "delivered" }, count,
      ]);
      await client.query("insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data) values ($1,'bookings','other-service','{\"serviceId\":\"other\",\"status\":\"completed\"}')", [id]);
      await client.query("insert into messaging_catalog_items(messaging_business_id,id,type,name,price) values ($1,'inventory',$2,$3,100)", [id, product === "motos" ? "vehicle" : "product", slug]);
      const { rows: [{ id: conversation }] } = await client.query(
        "insert into whatsapp_conversations(messaging_business_id,created_at,last_incoming_at) values ($1,$2,$3) returning id",
        [id, yesterday, at],
      );
      for (let index = 0; index < count; index++) {
        await client.query("insert into whatsapp_messages(messaging_business_id,conversation_id,meta_message_id,direction,delivery_status,provider_timestamp) values ($1,$2,$3,'outgoing','sent',$4)", [id, conversation, `${slug}-${index}`, at]);
      }
      await client.query("insert into whatsapp_message_events(messaging_business_id,meta_event_id,meta_message_id,status) values ($1,$2,$3,'read')", [id, slug, `${slug}-0`]);
      await client.query("insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data,created_at) values ($1,'messages','duplicate',$2,$3), ($1,'messages','failed',$4,$3)",
        [id, { messageId: `${slug}-0`, direction: "outgoing", deliveryStatus: "sent", conversationId: conversation }, at,
          { direction: "outgoing", deliveryStatus: "failed", conversationId: conversation }]);
    }
    const db = { execute(query) { const { sql, params } = dialect.sqlToQuery(query); return client.query(sql, params); } };
    const all = await getOperationalOverview(null, { now, db, includeTestData: true });
    assert.deepEqual(all.metrics, { businesses: 3, connected: 3, conversations: 3, sent: 6, automations: 3, campaigns: 3, customers: 0 });
    assert.deepEqual(all.directory, []);
    assert.equal(all.productActivity, null);
    assert.deepEqual(all.health, { delivered: 0, read: 3, failed: 3, pending: 0, sent: 3, unknown: 0, total: 9 });
    assert.equal(all.days.at(-1).outgoing, 9);
    assert.equal(all.days.at(-2).conversations, 3);
    assert.equal(all.attention.length, 3);
    assert.ok(all.activity.every(event => ["retail-live", "eats-live", "motos-live"].includes(event.id)));
    for (const [product, sent, testSent] of [["retail", 2, 9], ["eats", 3, 6], ["motos", 1, 4]]) {
      const eligible = await listProductTenants([product], db);
      assert.deepEqual(eligible.map(row => row.legacy_business_id), [`${product}-live`]);
      const records = await listProductRecords(product, product === "motos" ? "test-drives" : "orders", db);
      assert.equal(records.length, sent);
      assert.ok(records.every(row => row.businessId === `${product}-live`));
      const scoped = await getOperationalOverview(product, { now, db });
      assert.deepEqual(scoped.metrics, { businesses: 1, connected: 1, conversations: 1, sent, automations: 1, campaigns: 1, customers: sent });
      assert.deepEqual(scoped.directory.map(row => [row.id, row.product, row.whatsapp]), [[`${product}-live`, product, "connected"]]);
      assert.deepEqual(scoped.productActivity, { recorded: sent, completed: sent });
      assert.equal(scoped.days.at(-1).outgoing, sent + 1);
      assert.equal(scoped.health.total, sent + 1);
      assert.equal(scoped.health.failed, 1);
      assert.deepEqual(scoped.attention.map(row => row.id), [`${product}-live`]);
      assert.ok(scoped.activity.length > 0 && scoped.activity.every(row => row.id === `${product}-live`));
      assert.deepEqual(scoped.breakdown.map(row => row.product), [product]);
      const dev = await getOperationalOverview(product, { now, db, includeTestData: true });
      assert.deepEqual(dev.directory.map(row => [row.id, row.kind]), [[`${product}-live`, "live"], [`test-${product}`, "test"]]);
      assert.deepEqual(dev.metrics, {
        businesses: 2, connected: 2, conversations: 2, sent: sent + testSent,
        automations: 2, campaigns: 2, customers: sent + testSent,
      });
      const devRecords = await listProductRecords(product, product === "motos" ? "test-drives" : "orders", db, true);
      assert.equal(devRecords.length, sent + testSent);
      assert.ok(devRecords.every(row => [`${product}-live`, `test-${product}`].includes(row.businessId)));
    }
    process.env.MESSAGING_POSTGRES_TARGET = "production";
    try {
      assert.deepEqual((await listProductTenants(["retail"], db, true)).map(row => row.legacy_business_id), ["retail-live"]);
    } finally { process.env.MESSAGING_POSTGRES_TARGET = "staging"; }
    assert.deepEqual((await listProductRecords("motos", "vehicles", db)).map(row => row.name), ["motos-live"]);
    assert.deepEqual((await listProductRecords("retail", "products", db)).map(row => row.name), ["retail-live"]);
    assert.equal((await listProductRecords("eats", "delivery", db)).length, 3);
    assert.deepEqual(await listProductRecords("retail", "vehicles", db), []);
    await client.query("delete from pg_temp.whatsapp_phone_mappings where phone_number_id = 'retail-live'");
    const unmapped = await getOperationalOverview("retail", { now, db });
    assert.equal(unmapped.metrics.connected, 0);
    assert.equal(unmapped.directory[0].whatsapp, "setup");
    await client.query("update pg_temp.whatsapp_accounts set status = 'disconnected', phone_number_id = null where phone_number_id = 'retail-live'");
    const disconnected = await getOperationalOverview("retail", { now, db });
    assert.equal(disconnected.directory[0].whatsapp, "disconnected", "cleared phone and historical verification must not hide disconnected state");
    console.log("PASS scoped production tenants, KPIs, messages, attention, orders, delivery, bookings and inventory");
  } finally {
    await client.query("rollback").finally(() => client.end());
  }
}

async function main() {
  const assert = (await import("node:assert/strict")).default;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  Object.assign(process.env, { MESSAGING_DATABASE: "postgres", MESSAGING_POSTGRES_TARGET: "staging" });
  const { tanyProducts, verticalConfig, activeTanyVerticals } = await import("../lib/messaging/vertical-config.ts");
  const { classifyTenant } = await import("../lib/admin/tenant-classification.ts");
  const center = await import("../lib/admin/product-center.ts");
  const { getOperationalOverview } = await import("../lib/admin/operational-overview.ts");
  const { adminProductPath, adminProductFromPath } = await import("../lib/admin/product-routes.ts");
  const { productNavigation } = await import("../lib/admin/product-navigation.ts");
  const { listProductTenants } = await import("../lib/admin/product-scope.ts");
  const { listProductRecords } = await import("../lib/admin/product-records.ts");
  const { canIncludeStagingTestData, isConfirmedStagingDatabase, isLocalStaging } = await import("../lib/admin/staging-environment.ts");
  const devEnv = { ...process.env, NODE_ENV: "development" };
  assert.ok(isConfirmedStagingDatabase(devEnv), "fixture tests require the confirmed staging database");
  assert.ok(isLocalStaging("localhost:3000", devEnv));
  assert.ok(isLocalStaging("[::1]:3000", devEnv));
  const prodEnv = { ...devEnv, NODE_ENV: "production", MESSAGING_POSTGRES_TARGET: "production" };
  assert.equal(canIncludeStagingTestData("localhost:3000", prodEnv), false);
  assert.equal(canIncludeStagingTestData("tany-whatsapp.tany-8b9.workers.dev", prodEnv), false);
  assert.equal(canIncludeStagingTestData("tany.example", devEnv), false);
  assert.equal(isLocalStaging("localhost", { ...devEnv, NODE_ENV: "production" }), false);
  assert.ok(canIncludeStagingTestData("tany-whatsapp.tany-8b9.workers.dev", { ...devEnv, NODE_ENV: "production" }));
  for (const target of ["postgres://production.example/neondb", "postgres://anonymous-neon.example/neondb", `${devEnv.DATABASE_URL}&host=other.example`]) {
    assert.equal(isConfirmedStagingDatabase({ ...devEnv, DATABASE_URL: target }), false);
  }

  // 1. Products come from the existing registry: 12 products, Motos/Eats/Retail live.
  assert.equal(tanyProducts.length, 12);
  assert.equal(adminProductPath(), "/admin");
  assert.equal(adminProductFromPath("/admin/products"), undefined);
  for (const product of tanyProducts) {
    const route = `/admin/products/${product.id}`;
    assert.equal(adminProductPath(product.id), route);
    assert.equal(adminProductFromPath(route)?.name, product.name);
    assert.equal(adminProductFromPath(`${route}/settings`)?.id, product.id);
    const links = productNavigation(product).flatMap(group => group.links);
    assert.ok(links.every(link => link.href === route || link.href.startsWith(route + "/")));
    const sections = links.map(link => link.section);
    if (product.status === "coming_soon") assert.deepEqual(sections, ["overview", "settings"]);
    else {
      const modules = {
        motos: ["dealers", "leads", "vehicles", "test-drives", "customers"],
        eats: ["restaurants", "orders", "customers", "delivery"],
        retail: ["stores", "orders", "products", "customers"],
      };
      assert.deepEqual(sections, ["overview", ...modules[product.id], "inbox", "templates", "automations", "campaigns", "whatsapp", "message-status", "webhook-health", "settings"]);
    }
  }
  assert.deepEqual(tanyProducts.map(p => p.id), Object.keys(verticalConfig), "same products and order as the registry");
  assert.deepEqual(tanyProducts.map(p => p.name), Object.values(verticalConfig).map(v => v.label));
  assert.deepEqual(tanyProducts.filter(p => p.status === "live").map(p => p.id).sort(), [...activeTanyVerticals].sort());
  assert.deepEqual(tanyProducts.filter(p => p.status === "live").map(p => p.id).sort(), ["eats", "motos", "retail"]);
  assert.ok(tanyProducts.filter(p => p.status !== "live").every(p => p.status === "coming_soon"), "the other 9 are coming soon");
  console.log("PASS 12 products from the registry; Motos, Eats and Retail are Live; 9 are Coming soon");

  // 2. Classification: explicit tenantKind first, then the immutable id prefix; never the display name.
  for (const [business, kind] of [
    [{ id: "phase6-eats-64c1" }, "migration"], [{ id: "phase12-test-x" }, "migration"], [{ id: "test-retail" }, "test"], [{ id: "demo-retail" }, "demo"],
    [{ id: "sellers-hypermarket" }, "live"], [{ id: "testing-co" }, "live"], [{ id: "acme", settings: { tenantKind: "test" } }, "test"],
    [{ id: "test-pilot", settings: { tenantKind: "live" } }, "live"], [{ id: "acme", settings: { tenantKind: "bogus" } }, "live"],
  ]) assert.equal(classifyTenant(business), kind, `${business.id} → ${kind}`);
  console.log("PASS classification: explicit tenantKind, then test-/demo-/phase<N>- id prefixes; display names are never used");

  // 3. Product metrics are scoped to one product and exclude test/demo/migration tenants.
  const base = { active: true, createdAt: null, whatsapp: "connected", displayPhone: "", conversations: 1, conversationsToday: 1, customers: 1, activeAutomations: 1, campaigns: 1, templates: 1, approvedTemplates: 1, incoming24h: 1, outgoing24h: 1, failed24h: 0, lastActivity: null };
  const fixture = [
    { ...base, id: "acme-retail", name: "Acme Retail", product: "retail", kind: "live", conversations: 5 },
    { ...base, id: "spice-route", name: "Spice Route", product: "eats", kind: "live", conversations: 7 },
    { ...base, id: "fast-motors", name: "Fast Motors", product: "motos", kind: "live", conversations: 3, whatsapp: "setup" },
    { ...base, id: "test-retail", name: "Test Retail", product: "retail", kind: "test", conversations: 100 },
    { ...base, id: "phase6-eats-x", name: "Phase 6 Eats", product: "eats", kind: "migration", conversations: 100 },
    { ...base, id: "demo-retail", name: "Demo Retail", product: "retail", kind: "demo", conversations: 100 },
  ];
  const summaries = Object.fromEntries(center.productSummaries(fixture).map(p => [p.id, p]));
  assert.equal(summaries.retail.totals.businesses, 1); assert.equal(summaries.retail.totals.conversations, 5, "Retail counts Retail's real businesses only");
  assert.equal(summaries.eats.totals.businesses, 1); assert.equal(summaries.eats.totals.conversations, 7, "Eats counts Eats only");
  assert.equal(summaries.motos.totals.businesses, 1); assert.equal(summaries.motos.totals.conversations, 3, "Motos counts Motos only");
  assert.equal(summaries.motos.totals.connected, 0, "only connected WhatsApp accounts count as connected");
  for (const id of ["cabs", "ecom", "expert", "gaming", "garage", "meat", "meds", "salon", "sport"])
    assert.deepEqual([summaries[id].totals.businesses, summaries[id].totals.conversations], [0, 0], `${id} shows no invented metrics`);
  const overall = center.totalsFor(center.realBusinesses(fixture));
  assert.equal(overall.businesses, 3, "overview counts real businesses only");
  assert.equal(overall.conversations, 15, "test, demo and migration activity is excluded");
  assert.equal(center.messagingHealth({ ...overall, outgoing24h: 100, failed24h: 10 }), "delivery_issues");
  assert.equal(center.messagingHealth({ ...overall, incoming24h: 0, outgoing24h: 0 }), "quiet");
  assert.equal(center.startOfTodayIst(Date.UTC(2026, 10, 27, 20, 0)).toISOString(), "2026-11-27T18:30:00.000Z", "today starts at midnight IST");
  console.log("PASS Retail, Eats and Motos metrics are product-scoped; test, demo and migration tenants are excluded; non-live products show none");
  await checkOverview(assert, getOperationalOverview, listProductTenants, listProductRecords);

  // 4. Staging (read only): every current tenant is test, demo or migration data, so default metrics are empty.
  const staging = await center.listProductBusinesses();
  assert.ok(staging.length > 0);
  const byKind = kind => staging.filter(b => b.kind === kind).map(b => b.id);
  assert.ok(byKind("migration").every(id => /^phase\d+-/.test(id)) && byKind("migration").length > 0, "phase6 tenants are migration fixtures");
  assert.ok(["test-retail", "test-eats", "test-motos"].every(id => byKind("test").includes(id)));
  assert.ok(byKind("demo").includes("demo-retail"));
  assert.ok(staging.every(b => b.kind !== "live" || !/^(test-|demo-|phase\d+-)/.test(b.id)), "no test/demo/migration tenant is treated as a real business");
  assert.ok(center.productSummaries(staging).every(p => p.status === "live" || p.totals.businesses === 0));
  console.log(`PASS staging read: ${staging.length} tenants classified (${byKind("migration").length} migration, ${byKind("test").length} test, ${byKind("demo").length} demo, ${byKind("live").length} live)`);

  // 5. Pages check Super Admin access before reading data; Postgres only; no migration wording.
  const pages = {
    "app/admin/page.tsx": "getOperationalOverview(null)",
    "app/admin/products/[product]/page.tsx": "getOperationalOverview(liveProduct,",
    "app/admin/products/[product]/[section]/page.tsx": "getProductOperationsData(product.id,",
    "app/admin/businesses/page.tsx": "listProductBusinesses()",
    "app/admin/system/page.tsx": "listProductBusinesses()",
  };
  for (const [page, load] of Object.entries(pages)) {
    const source = fs.readFileSync(page, "utf8");
    assert.ok(source.indexOf("isSuperAdmin()") > 0 && source.indexOf("isSuperAdmin()") < source.indexOf(load), `${page} checks access before data`);
    assert.doesNotMatch(source, /mirrored|Firestore|Postgres|migration terminology/i, `${page} has no technical wording`);
  }
  const data = fs.readFileSync("lib/admin/product-center.ts", "utf8");
  assert.doesNotMatch(data, /firebase-admin|adminDb|collection\(/, "Postgres only, no Firestore fallback");
  assert.match(data, /from messaging_businesses b/);
  const shell = fs.readFileSync("app/admin/components/admin-shell.tsx", "utf8");
  for (const label of ["Home", "Inbox", "Customers", "Automations", "Campaigns", "Templates", "WhatsApp", "Settings"]) assert.ok(shell.includes(`label: "${label}"`), `business navigation keeps ${label}`);
  assert.match(shell, /function businessNavigation/, "business navigation is unchanged and separate");
  console.log("PASS every Super Admin page checks access before data; Postgres only; business navigation unchanged");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
