/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness, demoBusiness } = require("./messaging-test-helpers.cjs");

async function main() {
  const h = createHarness({ seedFixtures: false });
  const products = h.load("lib/messaging/vertical-config.ts");
  assert.deepEqual(Object.keys(products.verticalConfig), ["motos", "eats", "cabs", "ecom", "expert", "gaming", "garage", "meat", "meds", "retail", "salon", "sport"]);
  assert.deepEqual(products.activeTanyVerticals, ["motos", "eats", "retail"]);
  for (const vertical of ["cabs", "ecom", "expert", "gaming", "garage", "meat", "meds", "salon", "sport"])
    assert.equal(products.isActiveTanyVertical(vertical), false, `${vertical} is coming soon`);
  const registry = h.load("lib/automations/vertical-registry.ts");
  assert.deepEqual(Object.keys(registry.verticalRegistry), ["eats", "retail", "motos"]);
  for (const vertical of ["eats", "retail", "motos"]) {
    const definition = registry.getVerticalDefinition(vertical);
    const recipes = registry.recipesForRegisteredVertical(vertical);
    assert.ok(definition && recipes.length > 0, `${vertical} has its automation recipes`);
    assert.ok(recipes.every(recipe => recipe.vertical === vertical), `${vertical} has no recipe leakage`);
    assert.ok(definition.supportedTriggers.length && definition.supportedActions.length);
  }
  assert.deepEqual(registry.recipesForRegisteredVertical("salon"), []);
  assert.deepEqual(registry.recipesForRegisteredVertical("cabs"), []);
  const simulator = h.load("app/admin/components/automations/chat-simulator.ts");
  for (const vertical of ["eats", "retail", "motos"]) {
    const scenario = simulator.previewScenarioKey(`${vertical}_welcome`, "Welcome", vertical);
    const initial = simulator.initialChat(scenario, "Demo", [], true);
    assert.ok(initial.length && initial.at(-1).actions?.length, `${vertical} preview is interactive`);
    assert.ok(simulator.continueChat(initial.at(-1).actions[0]).length > 1, `${vertical} preview remains local`);
  }
  for (const vertical of ["eats", "retail", "motos"]) h.seed(`businesses/${vertical}`, { ...demoBusiness, vertical, name: `Demo ${vertical}` });
  h.seed("businesses/multi", { ...demoBusiness, products: ["eats", "cabs", "retail"], name: "Multi product" });
  h.seed("businesses/cabs", { ...demoBusiness, vertical: "cabs", name: "Coming soon Cabs" });
  h.seed("businesses/inactive", { ...demoBusiness, vertical: "salon", name: "Inactive product" });
  const entitlements = h.load("lib/subscriptions/entitlements.ts");
  assert.equal(await entitlements.canUseWhatsApp("eats"), true, "eligible plan and active product can use WhatsApp");
  await entitlements.assignDemoSubscription("eats", "basic");
  assert.equal(await entitlements.canUseWhatsApp("eats"), false, "lower plan cannot use WhatsApp");
  await entitlements.assignDemoSubscription("eats", "pro");
  assert.deepEqual(await entitlements.getEnabledProducts("multi"), ["eats", "retail"], "multi-product access excludes coming-soon products");
  assert.deepEqual(await entitlements.getEnabledProducts("inactive"), [], "inactive products never gain access");
  assert.deepEqual(await entitlements.getEnabledProducts("cabs"), [], "Cabs cannot gain WhatsApp access");
  const service = h.load("lib/automations/service.ts");
  await service.saveAutomation("eats", undefined, { name: "Menu", description: "", trigger: { type: "order.created" }, conditions: [], actions: [{ type: "list", text: "Choose", choices: ["Menu"] }] });
  await service.saveAutomation("retail", undefined, { name: "Ready", description: "", trigger: { type: "order.status.changed" }, conditions: [{ type: "order_status", value: "ready" }], actions: [{ type: "text", text: "Your order is ready." }] });
  await service.saveAutomation("motos", undefined, { name: "Lead", description: "", trigger: { type: "keyword.matched", keywords: ["car"] }, conditions: [], actions: [{ type: "text", text: "Tell us the vehicle." }] });
  await assert.rejects(() => service.saveAutomation("motos", undefined, { name: "No payment", description: "", trigger: { type: "customer.message.received" }, conditions: [], actions: [{ type: "payment_link" }] }), /not available/);
  await assert.rejects(() => service.saveAutomation("cabs", undefined, { name: "Blocked", description: "", trigger: { type: "customer.message.received" }, conditions: [], actions: [{ type: "text", text: "Hello" }] }), entitlements.EntitlementError);
  const multiDashboard = await service.automationDashboard("multi");
  assert.ok(multiDashboard.recipes.length > 0);
  assert.ok(multiDashboard.recipes.every(recipe => ["eats", "retail"].includes(recipe.vertical)), "multi-product recipes exclude coming-soon products");
  assert.ok(multiDashboard.recipes.some(recipe => recipe.vertical === "eats"));
  assert.ok(multiDashboard.recipes.some(recipe => recipe.vertical === "retail"));
  assert.ok((await service.automationDashboard("motos")).recipes.every(recipe => recipe.vertical === "motos"), "a Motos business sees Motos recipes only");
  await assert.rejects(() => service.automationDashboard("inactive"), entitlements.EntitlementError, "unknown/inactive vertical is rejected");
  console.log("PASS: three active verticals, scoped recipes, trigger/action enforcement, local previews, and coming-soon product gating.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
