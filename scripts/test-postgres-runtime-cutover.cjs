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
  const schema = await client.query("select to_regclass('public.messaging_catalog_items') as catalog, to_regclass('public.whatsapp_catalog_product_mappings') as mappings");
  assert.ok(schema.rows[0].catalog && schema.rows[0].mappings, "Phase 6 schema must exist in staging");
  const suffix = randomUUID().replaceAll("-", "");
  const tenantA = `phase6-test-${suffix}`;
  const tenantB = `phase6-other-${suffix}`;
  const tenantC = `phase6-eats-${suffix}`;
  const phoneNumberId = `9${[...suffix].map(character => parseInt(character, 16) % 10).join("")}`.slice(0, 40);
  const phone = "+919123456789";
  const envBefore = { names: process.env.WHATSAPP_TOKEN_SECRET_NAMES, bindings: process.env.WHATSAPP_TOKEN_SECRET_BINDINGS, token: process.env.PHASE6_STAGING_META_TOKEN, manual: process.env.WHATSAPP_SETUP_ALLOW_MANUAL_TEST };
  const originalFetch = global.fetch;
  let firestoreCollection = null;
  let firestoreCollectionOriginal;
  let firestoreTransactionOriginal;
  let repository;
  let itemId = `catalog-${suffix}`;
  try {
    await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status,whatsapp_phone_number_id,products,settings) values($1,'Phase 6 test','retail','active',$2,'[\"retail\",\"motos\"]'::jsonb,'{}'::jsonb),($3,'Phase 6 other','motos','active',null,'[\"motos\"]'::jsonb,'{}'::jsonb),($4,'Phase 6 Eats','eats','active',null,'[\"eats\"]'::jsonb,'{}'::jsonb)", [tenantA, phoneNumberId, tenantB, tenantC]);
    const { PostgresMessagingRepository } = await import("../lib/data/postgres-messaging-repository.ts");
    repository = new PostgresMessagingRepository();
    await repository.mirrorAccount({ id: tenantA, businessId: tenantA, vertical: "retail", setupType: "existing", phoneNumberId, wabaId: "12345", displayPhone: phone, displayName: "Phase 6 test", tokenSecretName: "PHASE6_STAGING_META_TOKEN", status: "connected", testPassed: true, validationMode: "live", testedAt: new Date(), setupStep: 5, revision: 1 });
    await repository.saveCatalogItem(tenantA, itemId, { type: "product", name: "Test Item", description: "", price: 10, available: true, category: "Test", metadata: { stock: 5 } });
    await repository.saveCatalogItem(tenantC, itemId, { type: "product", name: "Eats Test Item", description: "", price: 10, available: true, category: "Test", metadata: { stock: 5 } });
    await repository.writeSubscriptionEntitlement({ businessId: tenantA, plan: "pro", status: "active", startedAt: Date.now() - 1000, expiresAt: Date.now() + 86400000, whatsappAutomation: true, campaigns: true, advancedAnalytics: false, aiAssistant: false });

    process.env.WHATSAPP_TOKEN_SECRET_NAMES = "PHASE6_STAGING_META_TOKEN";
    process.env.WHATSAPP_TOKEN_SECRET_BINDINGS = JSON.stringify({ [tenantA]: "PHASE6_STAGING_META_TOKEN" });
    process.env.PHASE6_STAGING_META_TOKEN = `staging-token-${suffix}`;
    const { adminDb } = await import("../lib/firebase-admin.ts");
    firestoreCollection = adminDb.collection;
    firestoreCollectionOriginal = firestoreCollection.bind(adminDb);
    adminDb.collection = () => { throw new Error("FIRESTORE_RUNTIME_READ_FORBIDDEN"); };
    firestoreTransactionOriginal = adminDb.runTransaction.bind(adminDb);
    adminDb.runTransaction = () => { throw new Error("FIRESTORE_RUNTIME_TRANSACTION_FORBIDDEN"); };

    const { getBusinessConfig } = await import("../lib/messaging/services/business-config-service.ts");
    const { getCatalog, getCatalogItem } = await import("../lib/messaging/services/catalog-service.ts");
    const { getCatalogConfiguration, catalogSettingsData } = await import("../lib/whatsapp/catalog.ts");
    const { findBusinessByPhoneNumberId } = await import("../lib/messaging/business.ts");
    const { getEnabledProducts } = await import("../lib/subscriptions/entitlements.ts");
    const { routeMessage } = await import("../lib/messaging/router.ts");
    const { sendWhatsAppMessage } = await import("../lib/messaging/whatsapp.ts");
    const { hasEntitlement } = await import("../lib/subscriptions/entitlements.ts");
    const identity = await import("../lib/messaging/services/identity-service.ts");
    const { getOrCreateCustomer } = await import("../lib/messaging/services/customer-service.ts");
    const conversations = await import("../lib/messaging/services/conversation-service.ts");
    const orderService = await import("../lib/messaging/services/order-service.ts");
    const bookingService = await import("../lib/messaging/services/booking-service.ts");
    const paymentService = await import("../lib/messaging/services/payment-service.ts");
    const { claimIncomingMessage, markMessageProcessed } = await import("../lib/messaging/services/message-service.ts");

    const demoRetail = await getBusinessConfig("demo-retail");
    assert.equal(demoRetail?.vertical, "retail");
    const hi = await routeMessage({ id: "demo-retail", name: demoRetail.name, vertical: demoRetail.vertical, whatsappPhoneNumberId: demoRetail.whatsappPhoneNumberId, active: true }, "Hi", { customerPhone: "919999999999" });
    assert.ok(hi.reply.type === "list" && hi.reply.sections.some(section => section.rows.some(row => row.title === "Shop Products")));
    console.log("PASS Postgres business config Retail Hi → Shop Products");
    const demoCatalog = await getCatalog("demo-retail");
    assert.ok(demoCatalog.length > 0, "demo-retail catalog backfill should be queryable");
    assert.ok(await getCatalogItem(tenantA, itemId));
    assert.equal(await getCatalogItem(tenantB, itemId), null);
    assert.equal((await getCatalogConfiguration(tenantA)).hasAccount, true);
    assert.ok((await catalogSettingsData(tenantA)).mappings.length === 0);
    console.log("PASS Postgres catalog lookup and tenant isolation");
    assert.deepEqual(await getEnabledProducts(tenantA), ["retail", "motos"]);
    assert.equal(await hasEntitlement(tenantA, "whatsappAutomation"), true);
    const routed = await findBusinessByPhoneNumberId(phoneNumberId);
    assert.equal(routed?.id, tenantA);
    assert.equal(routed?.vertical, "retail");
    console.log("PASS Postgres vertical/product routing");

    const linkToken = await identity.createOrReuseLinkSession("919123456789", tenantA, "hello");
    const linked = await identity.completeLinkSession(linkToken, `phase6_${suffix.slice(0, 12)}`);
    assert.equal(linked.businessId, tenantA);
    assert.ok(await identity.resolveWhatsAppIdentity("919123456789"));
    console.log("PASS Postgres identity/link-session flow and entitlement check");

    const customer = await getOrCreateCustomer({ businessId: tenantA, phone: "919123456789" });
    const conversation = await conversations.getOrCreateConversation({ businessId: tenantA, customerPhone: "919123456789", vertical: "retail" });
    await conversations.updateConversationState({ businessId: tenantA, customerPhone: "919123456789", state: "retail_main_menu", lastIncomingText: "Hi" });
    assert.equal((await conversations.getConversation({ businessId: tenantA, customerPhone: "919123456789" }))?.state, "retail_main_menu");
    console.log("PASS Postgres customer and conversation reads/writes");

    const order = await orderService.createDraftOrder({ businessId: tenantA, customerPhone: "919123456789", vertical: "retail" });
    await orderService.addOrderItem({ orderId: order.id, item: { id: itemId, name: "Test Item", quantity: 2, unitPrice: 10 } });
    const updatedOrder = await orderService.getOrder(order.id);
    assert.equal(updatedOrder.total, 20);
    const payment = await paymentService.createPendingPayment({ businessId: tenantA, customerPhone: "919123456789", amount: 20, referenceType: "order", referenceId: order.id, idempotencyKey: `phase6-${suffix}` });
    assert.equal((await paymentService.markPaymentFailed({ paymentId: payment.id, reason: "test" })).status, "failed");
    const booking = await bookingService.createDraftBooking({ businessId: tenantA, customerPhone: "919123456789", vertical: "retail" });
    assert.equal((await bookingService.updateBooking({ bookingId: booking.id, data: { status: "confirmed" } })).status, "confirmed");
    const cartOrder = await orderService.createDraftOrder({ businessId: tenantC, customerPhone: "919111111111", vertical: "eats" });
    const { changeCart, setCartDelivery, confirmCartOrder } = await import("../lib/messaging/services/cart-service.ts");
    const cart = await changeCart({ businessId: tenantC, customerPhone: "919111111111", orderId: cartOrder.id, eventId: `cart-${suffix}`, mode: "set", selections: [{ productId: itemId, quantity: 2 }] });
    assert.equal(cart.total, 20);
    const deliveryCart = await setCartDelivery(tenantC, "919111111111", cart.id, { latitude: 12.9, longitude: 77.6, address: "Test address", label: "Home", source: "manual", updatedAt: new Date() });
    assert.equal((await confirmCartOrder(deliveryCart)).status, "awaiting_payment");
    console.log("PASS Postgres order/cart/payment/booking paths");

    const incoming = await claimIncomingMessage({ businessId: tenantA, vertical: "retail", customerPhone: "919123456789", messageId: `wamid.phase6.${suffix}`, type: "text", text: "hello", whatsappTimestamp: String(Math.floor(Date.now() / 1000)) });
    assert.ok(incoming);
    await markMessageProcessed(incoming);
    const { automationPersistence } = await import("../lib/automations/persistence.ts");
    const automationId = `phase6-auto-${suffix}`;
    await automationPersistence().create("automations", { id: automationId, businessId: tenantA, product: "retail", status: "active", name: "Phase 6 test", description: "test", trigger: { type: "keyword.matched", keywords: ["hello"] }, conditions: [], actions: [{ type: "text", text: "Automation reply" }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishedAt: new Date().toISOString() });

    process.env.MESSAGING_DATABASE = "dual-write";
    assert.equal((await getCatalogItem(tenantA, itemId))?.name, "Test Item");
    assert.equal((await getEnabledProducts(tenantA)).includes("motos"), true);
    assert.equal((await findBusinessByPhoneNumberId(phoneNumberId))?.id, tenantA);
    process.env.MESSAGING_DATABASE = "postgres";
    console.log("PASS dual-write routes runtime reads to Postgres");

    const { sendingAccessToken } = await import("../lib/whatsapp/runtime-account.ts");
    assert.equal(await sendingAccessToken(phoneNumberId), process.env.PHASE6_STAGING_META_TOKEN);
    console.log("PASS Postgres secret-reference credential resolution");
    let request;
    global.fetch = async (urlValue, init) => {
      if (!String(urlValue).startsWith("https://graph.facebook.com/")) return originalFetch(urlValue, init);
      request = { url: String(urlValue), init };
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.phase6-test" }] }) };
    };
    await sendWhatsAppMessage({ phoneNumberId, to: "919999999999", reply: { type: "text", body: "Test reply" } });
    assert.match(request.url, new RegExp(`${phoneNumberId}/messages$`));
    assert.equal(request.init.headers.Authorization, `Bearer ${process.env.PHASE6_STAGING_META_TOKEN}`);
    console.log("PASS mocked Meta outgoing reply using Postgres credentials");
    const { runAutomationEvent } = await import("../lib/automations/automation-engine.ts");
    const automationResult = await runAutomationEvent({ id: `event-${suffix}`, type: "customer.message.received", businessId: tenantA, customerId: customer.id, conversationId: conversation.id, timestamp: new Date().toISOString(), payload: { text: "hello" }, source: "customer" }, automationId);
    assert.equal(automationResult.messageSent, true);
    console.log("PASS Postgres automation context and mocked outgoing reply");

    await repository.setBusinessActive(tenantA, false);
    assert.equal(await repository.findActiveBusinessByPhoneNumberId(phoneNumberId), null);
    await assert.rejects(() => sendingAccessToken(phoneNumberId), /not active/);
    await repository.setBusinessActive(tenantA, true);
    console.log("PASS Postgres business active/inactive enforcement");
    const { saveWhatsAppSetup, getWhatsAppSetup, testWhatsAppSetup, activateWhatsAppSetup, disconnectWhatsAppSetup } = await import("../lib/whatsapp/setup-service.ts");
    await disconnectWhatsAppSetup(tenantA);
    const setup = await saveWhatsAppSetup(tenantA, { setupType: "existing", displayName: "Phase 6 test", displayPhone: "+919123456789", phoneNumberId, wabaId: "12345", tokenSecretName: "PHASE6_STAGING_META_TOKEN" });
    assert.equal(setup?.status, "pending");
    process.env.WHATSAPP_SETUP_ALLOW_MANUAL_TEST = "true";
    await testWhatsAppSetup(tenantA, { mode: "manual_test", sendTest: false });
    assert.equal((await getWhatsAppSetup(tenantA))?.testPassed, true);
    assert.equal((await activateWhatsAppSetup(tenantA))?.status, "connected");
    await disconnectWhatsAppSetup(tenantA);
    await repository.saveCatalogConfiguration(tenantA, "123456789", true);
    await repository.saveCatalogMapping(tenantA, itemId, "retailer-phase6", "123456789");
    assert.equal((await getCatalogConfiguration(tenantA)).catalogEnabled, true);
    assert.equal((await catalogSettingsData(tenantA)).mappings.length, 1);
    console.log("PASS Postgres WhatsApp setup and catalog config writes");
    await assert.rejects(() => repository.getBusiness(`unknown-${suffix}`), /POSTGRES_TENANT_UNMAPPED/);
    console.log("PASS Postgres tenant mapping rejects unknown tenant without fallback");
  } finally {
    if (firestoreCollectionOriginal) (await import("../lib/firebase-admin.ts")).adminDb.collection = firestoreCollectionOriginal;
    if (firestoreTransactionOriginal) (await import("../lib/firebase-admin.ts")).adminDb.runTransaction = firestoreTransactionOriginal;
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ WHATSAPP_TOKEN_SECRET_NAMES: envBefore.names, WHATSAPP_TOKEN_SECRET_BINDINGS: envBefore.bindings, PHASE6_STAGING_META_TOKEN: envBefore.token, WHATSAPP_SETUP_ALLOW_MANUAL_TEST: envBefore.manual })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (repository) {
      await client.query("delete from automation_events where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from automation_runs where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from automation_definitions where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from messaging_runtime_records where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2,$3))", [tenantA, tenantB, tenantC]);
      await client.query("delete from whatsapp_messages where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from whatsapp_conversations where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from whatsapp_contacts where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from whatsapp_customer_links where legacy_business_id in ($1,$2)", [tenantA, tenantB]);
      await client.query("delete from whatsapp_identities where phone=$1", ["919123456789"]);
      await client.query("delete from whatsapp_link_sessions where legacy_business_id in ($1,$2)", [tenantA, tenantB]);
      await client.query("delete from messaging_subscriptions where legacy_business_id in ($1,$2)", [tenantA, tenantB]);
      await client.query("delete from whatsapp_catalog_product_mappings where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2,$3))", [tenantA, tenantB, tenantC]);
      await client.query("delete from messaging_catalog_items where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2,$3))", [tenantA, tenantB, tenantC]);
      await client.query("delete from whatsapp_phone_mappings where phone_number_id=$1", [phoneNumberId]);
      await client.query("delete from whatsapp_accounts where messaging_business_id in (select id from messaging_businesses where legacy_business_id in ($1,$2))", [tenantA, tenantB]);
      await client.query("delete from messaging_businesses where legacy_business_id in ($1,$2,$3)", [tenantA, tenantB, tenantC]);
    }
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
