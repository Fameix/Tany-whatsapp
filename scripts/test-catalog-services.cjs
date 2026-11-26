/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { createHarness } = require('./messaging-test-helpers.cjs');
const { seedDemoBusinesses } = require('./seed-demo-businesses.cjs');

function setup() {
  const h = createHarness({ seedFixtures: false });
  const config = h.load('lib/messaging/services/business-config-service.ts');
  const catalog = h.load('lib/messaging/services/catalog-service.ts');
  const router = h.load('lib/messaging/router.ts');
  const customers = h.load('lib/messaging/services/customer-service.ts');
  const conversations = h.load('lib/messaging/services/conversation-service.ts');
  const business = (id, vertical, settings = {}) => {
    const value = { id, name: id, vertical, active: true, whatsappPhoneNumberId: 'phone-' + id, settings };
    h.seed('businesses/' + id, value); return value;
  };
  const item = (businessId, id, data) => h.seed(`businesses/${businessId}/catalog/${id}`, {
    id: 'untrusted-embedded-id', type: 'product', name: id, description: '', price: 10, available: true, category: null, metadata: {}, createdAt: null, updatedAt: null, ...data,
  });
  const send = async (b, value) => {
    const key = { businessId: b.id, customerPhone: '919999999999' };
    await customers.getOrCreateCustomer({ businessId: b.id, phone: key.customerPhone });
    const conversation = await conversations.getOrCreateConversation({ ...key, vertical: b.vertical });
    const result = await router.routeMessage(b, value, { customerPhone: key.customerPhone, conversation });
    await conversations.updateConversationState({ ...key, state: result.state, status: result.status, context: result.context, lastIncomingText: typeof value === 'string' ? value : value.text, pendingReply: result.reply.body });
    return result;
  };
  return { ...h, config, catalog, business, item, send };
}

async function main() {
  const h = setup();
  const a = h.business('tenant-a', 'eats', { deliveryFee: 0 });
  h.business('tenant-b', 'eats');
  h.item(a.id, 'dish-a', { name: 'Special Dosa', price: 137, metadata: { aliases: ['dosa', 'special'], preparationTime: 12 } });
  h.item(a.id, 'hidden', { name: 'Unavailable Dish', available: false, price: 2 });
  h.item('tenant-b', 'dish-b', { name: 'Other Tenant Dosa', price: 999, metadata: { aliases: ['dosa'] } });
  assert.equal((await h.catalog.getCatalog(a.id)).length, 2);
  assert.equal((await h.catalog.getAvailableCatalogItems(a.id)).length, 1);
  assert.equal((await h.catalog.getCatalog(a.id, { maxPrice: 5, available: false }))[0].id, 'hidden');
  assert.equal((await h.catalog.findCatalogItems(a.id, 'special'))[0].id, 'dish-a');
  assert.equal((await h.catalog.getCatalogItem(a.id, 'dish-a')).id, 'dish-a');
  assert.equal(await h.catalog.getCatalogItem(a.id, 'dish-b'), null);
  assert.equal((await h.catalog.findCatalogItems(a.id, 'Other Tenant')).length, 0);
  assert.equal((await h.catalog.getAvailableCatalogItems('tenant-b'))[0].price, 999);
  assert.equal((await h.config.getBusinessConfig(a.id)).settings.deliveryFee, 0);
  assert.equal(await h.config.getBusinessConfig('missing-business'), null);
  await assert.rejects(h.catalog.getCatalog('../tenant-b'));
  await assert.rejects(h.catalog.getCatalogItem(a.id, '../dish-b'));
  let result = await h.send(a, '2 dosa');
  assert.equal(result.state, 'eats_awaiting_location');
  let order = h.read('orders/' + result.context.orderId);
  assert.equal(order.total, 274);
  assert.equal(order.items[0].name, 'Special Dosa');
  assert.equal(order.items[0].id, 'dish-a');
  assert.equal(order.businessId, a.id);
  // Same phone, different business has its own catalog and conversation/order.
  const b = { ...(await h.config.getBusinessConfig('tenant-b')) };
  result = await h.send(b, '1 dosa');
  order = h.read('orders/' + result.context.orderId);
  assert.equal(order.total, 999);
  assert.equal(order.businessId, b.id);

  const motos = h.business('custom-motos', 'motos');
  h.item(motos.id, 'city_2023', { type: 'vehicle', name: 'Honda City 2023', price: 1200000, metadata: { brand: 'Honda', model: 'City', year: 2023, transmission: 'Automatic', bodyType: 'sedan', variant: 'ZX' } });
  h.item(motos.id, 'sold', { type: 'vehicle', name: 'Sold Car', available: false, metadata: { brand: 'Honda', model: 'City', year: 2022, transmission: 'Automatic' } });
  result = await h.send(motos, 'Honda automatic sedan');
  assert.equal(result.state, 'motos_showing_results');
  assert.equal(result.reply.sections[0].rows.length, 1);
  assert.equal(result.reply.sections[0].rows[0].id, 'motos_car_city_2023');
  result = await h.send(motos, { type: 'list', text: 'not trusted', selectionId: 'motos_car_city_2023' });
  assert.match(result.reply.body, /12,00,000/);
  assert.match(result.reply.body, /ZX/);

  const configs = {
    retail: { type: 'product', name: 'Custom Bag', price: 321, metadata: { aliases: ['bag'], variants: ['Red'], stock: 5 } },
  };
  const steps = { retail: ['bag', 'Red', '2'] };
  for (const [vertical, data] of Object.entries(configs)) {
    const business = h.business('custom-' + vertical, vertical, vertical === 'ecom' ? { quoteSettings: { estimateMultiplier: 0.8 } } : {});
    h.item(business.id, 'configured-item', data);
    for (const text of steps[vertical]) result = await h.send(business, text === 'LOCATION' ? { type: 'location', text: '', location: { latitude: 0, longitude: 0, label: null, address: null, source: 'manual', updatedAt: h.Timestamp.now() } } : text);
    assert.equal(result.state, `${vertical}_awaiting_confirmation`, vertical);
    const collection = result.context.orderId ? 'orders' : 'bookings';
    const record = h.read(`${collection}/${result.context.orderId ?? result.context.bookingId}`);
    const amount = collection === 'orders' ? record.total : record.amount;
    assert.equal(amount, data.price * 2, vertical);
  }

  for (const vertical of ['eats', 'motos', 'retail']) {
    const empty = h.business('empty-' + vertical, vertical);
    result = await h.send(empty, 'Hello');
    if (vertical === 'retail') assert.ok(result.reply.rows?.some(row => row.title === 'Shop Products') || result.reply.sections?.some(section => section.rows.some(row => row.title === 'Shop Products')), vertical);
    else assert.equal(result.reply.body, 'This business has not configured its catalog yet.', vertical);
    result = await h.send(empty, 'RESET');
    if (vertical === 'retail') assert.ok(result.reply && typeof result.reply.body === 'string', vertical + ' reset');
    else assert.equal(result.reply.body, 'This business has not configured its catalog yet.', vertical + ' reset');
  }
  for (const vertical of ['cabs', 'ecom', 'expert', 'gaming', 'garage', 'meat', 'meds', 'salon', 'sport'])
    await assert.rejects(() => h.send(h.business(`disabled-${vertical}`, vertical), 'Hello'), /not active/);

  // Demo seed is idempotent and never overwrites actual identity/prices.
  const seed = createHarness({ seedFixtures: false });
  seed.seed('businesses/demo-eats', { name: 'My Real Eats', vertical: 'eats', active: false, whatsappPhoneNumberId: 'KEEP_THIS', settings: { deliveryFee: 77 } });
  seed.seed('businesses/demo-eats/catalog/dosa', { name: 'My Dosa', price: 999 });
  const before = seed.documents.size;
  await seedDemoBusinesses(seed.adminDb, { dryRun: true });
  assert.equal(seed.documents.size, before);
  await seedDemoBusinesses(seed.adminDb);
  assert.equal(seed.read('businesses/demo-eats').name, 'My Real Eats');
  assert.equal(seed.read('businesses/demo-eats').whatsappPhoneNumberId, 'KEEP_THIS');
  assert.equal(seed.read('businesses/demo-eats').active, false);
  assert.equal(seed.read('businesses/demo-eats').settings.deliveryFee, 77);
  assert.equal(seed.read('businesses/demo-eats/catalog/dosa').price, 999);
  const afterSeed = seed.documents.size;
  await seedDemoBusinesses(seed.adminDb);
  assert.equal(seed.documents.size, afterSeed);
  assert.ok(seed.read('businesses/demo-retail/catalog/tshirt'));
  assert.ok(seed.read('businesses/demo-motos/catalog/creta_2021'));
  assert.equal(h.sends.length, 0);
  console.log('PASS: scoped catalog/config reads, tenant isolation, active Motos/Eats/Retail flows, coming-soon route rejection, and idempotent non-destructive demo seed. No live calls.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
