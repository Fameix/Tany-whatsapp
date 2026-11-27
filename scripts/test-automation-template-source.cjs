/* eslint-disable @typescript-eslint/no-require-imports */
// One message-template system: Automations hold no template catalogue, recipes own no
// message copy, and the "Send WhatsApp template" selector lists only this business's
// approved templates. The engine and the inbound "Hi" welcome keep working.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHarness, demoBusiness } = require("./messaging-test-helpers.cjs");

async function main() {
  // 1. No built-in automation template catalogue remains.
  for (const removed of [
    "lib/automations/product-templates.ts",
    "lib/automations/templates.ts",
    "app/admin/components/automations/template-gallery.tsx",
    "app/admin/components/automations/template-draft.ts",
    "app/admin/components/automations/eats-template-presentation.ts",
  ]) assert.equal(fs.existsSync(removed), false, `${removed} is removed`);
  const builder = fs.readFileSync("app/admin/components/automations/automation-builder.tsx", "utf8");
  for (const text of ["All templates for", "Show recommended", "Use Template", "Use Recommended Template", "AutomationTemplateGallery", "automationTemplates", "Welcome Customer"])
    assert.equal(builder.includes(text), false, `builder has no "${text}"`);
  for (const text of ["No automations yet", "Automatically respond to customers and trigger actions when business events happen.", "Create automation", "Automations can send your approved WhatsApp templates", "Automatically respond and act on customer or business events."])
    assert.ok(builder.includes(text), `builder shows "${text}"`);
  const registrySource = fs.readFileSync("lib/automations/vertical-registry.ts", "utf8");
  assert.equal(/\btemplates:\s*(eats|retail|motos)\b/.test(registrySource), false, "the registry owns no template catalogue");
  assert.equal(fs.readFileSync("lib/automations/service.ts", "utf8").includes("createAutomationFromTemplate"), false);
  assert.equal(fs.readFileSync("app/admin/automation-actions.ts", "utf8").includes("createAutomationFromTemplateAction"), false);
  assert.match(fs.readFileSync("app/business/[businessId]/templates/page.tsx", "utf8"), /Create and manage WhatsApp-approved messages\./);
  console.log("PASS Automations has no built-in message-template catalogue; Templates is the only template library");

  const h = createHarness({ seedFixtures: false });
  const registry = h.load("lib/automations/vertical-registry.ts");
  const templateModel = h.load("lib/templates/model.ts");
  const { startersFor } = h.load("lib/templates/starters.ts");
  const { automationPlaceholders } = h.load("lib/automations/placeholders.ts");

  // 2. Recipes set up a workflow and a template step only; they pair with a real starter.
  for (const vertical of ["retail", "eats", "motos"]) {
    const definition = registry.getVerticalDefinition(vertical);
    assert.ok(definition.automationActions.includes("template"), `${vertical} automations can send a WhatsApp template`);
    const recipes = registry.recipesForRegisteredVertical(vertical);
    assert.ok(recipes.length > 0, `${vertical} has recipes`);
    for (const recipe of recipes) {
      assert.equal(recipe.vertical, vertical);
      assert.ok(definition.automationTriggers.includes(recipe.trigger.type), `${recipe.id} uses a supported ${vertical} trigger`);
      for (const field of ["text", "body", "actions", "choices", "message"]) assert.equal(Object.hasOwn(recipe, field), false, `${recipe.id} owns no ${field}`);
      const starter = startersFor(vertical).find(candidate => candidate.key === recipe.suggestedTemplate);
      assert.ok(starter, `${recipe.id} suggests a ${vertical} starter that exists in Templates`);
      assert.equal(recipe.mapping.length, templateModel.templateVariables(starter.body).length, `${recipe.id} maps every variable of ${starter.key}`);
      for (const value of recipe.mapping)
        assert.ok(value === "" || automationPlaceholders.some(token => value === `{{${token}}}`), `${recipe.id} maps to a known context value`);
    }
  }
  assert.deepEqual(registry.recipesForRegisteredVertical("cabs"), []);
  assert.deepEqual(registry.recipesForEnabledProducts(["retail"]).map(r => r.vertical).filter(v => v !== "retail"), [], "recipes are product scoped");
  assert.ok(registry.recipesForRegisteredVertical("retail").some(r => r.suggestedTemplate === "retail_order_confirmed"));
  assert.ok(registry.recipesForRegisteredVertical("eats").some(r => r.suggestedTemplate === "eats_out_for_delivery"));
  assert.ok(registry.recipesForRegisteredVertical("motos").some(r => r.suggestedTemplate === "motos_test_drive_confirmed"));
  console.log("PASS recipes own no message copy, pair with real Templates starters, map every variable and use supported triggers");

  // 3. The template selector lists only this business's approved, sendable templates.
  h.seed("businesses/retail-a", { ...demoBusiness, name: "Retail A", vertical: "retail" });
  h.seed("businesses/retail-b", { ...demoBusiness, name: "Retail B", vertical: "retail" });
  const body = "Hi {{1}}, your order {{2}} has been confirmed.\n\nThank you.";
  const components = [{ type: "BODY", text: body }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Contact store" }] }];
  for (const [id, businessId, status, extra] of [
    ["a-approved", "retail-a", "approved", {}],
    ["a-draft", "retail-a", "draft", {}],
    ["a-pending", "retail-a", "pending", {}],
    ["a-rejected", "retail-a", "rejected", {}],
    ["a-media", "retail-a", "approved", { components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: body }] }],
    ["b-approved", "retail-b", "approved", {}],
  ]) h.seed(`templates/${id}`, { businessId, name: id.replace("-", "_"), status, language: "en", category: "utility", body, examples: ["Priya", "ORD-1"], components, ...extra });
  const service = h.load("lib/automations/service.ts");
  const dashboard = await service.automationDashboard("retail-a");
  assert.equal(Object.hasOwn(dashboard, "automationTemplates"), false, "the dashboard carries no automation template catalogue");
  assert.deepEqual(dashboard.templates.map(t => t.id), ["a-approved"], "approved, own-business, sendable templates only");
  const [listed] = dashboard.templates;
  assert.equal(listed.category, "utility");
  assert.equal(listed.language, "en");
  assert.deepEqual(listed.examples, ["Priya", "ORD-1"], "preview carries the template's example values");
  assert.deepEqual(listed.buttons, [{ type: "QUICK_REPLY", text: "Contact store" }]);
  assert.ok(dashboard.recipes.every(r => r.vertical === "retail"));
  assert.deepEqual((await service.automationDashboard("retail-b")).templates.map(t => t.id), ["b-approved"], "another business sees only its own");
  console.log("PASS selector lists this business's approved templates only: no draft, in review, rejected, unsendable or other-tenant templates");

  // Unusable templates are summarised (never selectable) so an empty picker is explained.
  assert.deepEqual(dashboard.unavailableTemplates.map(t => t.status).sort(), ["draft", "pending", "rejected"], "this business's draft, in review and rejected templates");
  assert.ok(dashboard.unavailableTemplates.every(t => t.name.startsWith("a_")), "no other tenant's templates in the summary");
  assert.deepEqual((await service.automationDashboard("retail-b")).unavailableTemplates, []);
  const { templateAvailabilitySummary } = templateModel;
  assert.deepEqual(templateAvailabilitySummary([{ name: "sellers_hypermarket", status: "pending" }]), {
    headline: "No approved templates yet",
    detail: 'Your template "sellers_hypermarket" is currently In review. It will become available for automations after Meta approves it.',
  });
  assert.match(templateAvailabilitySummary([{ name: "x", status: "draft" }]).detail, /is a draft\. Submit it to Meta/);
  assert.match(templateAvailabilitySummary([{ name: "x", status: "rejected" }]).detail, /was rejected by Meta\. Edit and resubmit/);
  assert.match(templateAvailabilitySummary([{ name: "a", status: "pending" }, { name: "b", status: "pending" }, { name: "c", status: "draft" }]).detail, /^2 templates are in review · 1 draft\./);
  assert.match(templateAvailabilitySummary([{ name: "a", status: "pending" }, { name: "b", status: "rejected" }]).detail, /^1 template is in review · 1 rejected\./);
  assert.match(templateAvailabilitySummary([]).detail, /Create a template in Templates/);
  for (const text of ["No approved templates available", "View templates", "TemplateAvailabilityPanel unavailable={data.unavailableTemplates}"])
    assert.ok(builder.includes(text) || fs.readFileSync("app/admin/components/automations/automation-builder.tsx", "utf8").includes(text), `builder shows "${text}"`);
  const page = fs.readFileSync("app/admin/components/automations/automation-page.tsx", "utf8");
  assert.ok(page.indexOf("await refreshTemplateStatuses(businessId)") > 0 && page.indexOf("await refreshTemplateStatuses(businessId)") < page.indexOf("data = await automationDashboard(businessId)"), "Meta status is refreshed before templates are listed");
  console.log("PASS unusable templates are explained (single status or counts) with a link to Templates; Meta status refreshes on load");

  // 4. Publishing a template step requires this business's approved template.
  const automation = (templateId, parameters = ["{{customer_name}}", "{{order_id}}"]) => ({
    name: "Order confirmed", description: "", trigger: { type: "order.status.changed" }, conditions: [{ type: "order_status", value: "confirmed" }],
    actions: [{ type: "template", templateId, parameters }],
  });
  for (const templateId of ["a-draft", "a-pending", "a-rejected", "b-approved"]) {
    const id = await service.saveAutomation("retail-a", undefined, automation(templateId));
    await assert.rejects(service.changeAutomation("retail-a", id, "publish"), undefined, `${templateId} cannot be published`);
  }
  const publishable = await service.saveAutomation("retail-a", undefined, automation("a-approved"));
  await service.changeAutomation("retail-a", publishable, "publish");
  assert.equal(h.read(`automations/${publishable}`).status, "active");
  assert.deepEqual(h.read(`automations/${publishable}`).actions[0].parameters, ["{{customer_name}}", "{{order_id}}"], "variables map to automation context");
  console.log("PASS only an approved template from the same business can be published in an automation; variable mappings are kept");

  // 5. Placeholders resolve from context and nothing private leaks.
  const placeholders = h.load("lib/automations/placeholders.ts");
  const values = placeholders.automationPlaceholderValues({
    business: { name: "Glow Retail", secret: "PRIVATE" }, customer: { name: "Asha", uid: "PRIVATE_UID" },
    order: { id: "order-123", total: 250 }, booking: { bookingDate: "2026-11-01", startTime: "10:30" }, payment: { amount: 250 },
  });
  assert.equal(placeholders.renderAutomationText("{{business_name}} | {{customer_name}} | {{order_id}} | {{booking_date}} | {{booking_time}} | {{amount}}", values), "Glow Retail | Asha | order-123 | 2026-11-01 | 10:30 | 250.00");
  assert.throws(() => placeholders.renderAutomationText("{{customer_name}}", {}));
  assert.throws(() => placeholders.renderAutomationText("{{uid}}", values));
  assert.ok(!JSON.stringify(values).includes("PRIVATE"));
  console.log("PASS template variables resolve from automation context; unknown or missing context is refused");

  // Builder previews stay local-only and render the selected approved template.
  const { previewMessages, previewText } = h.load("app/admin/components/automations/preview-messages.ts");
  const buttons = [{ type: "buttons", text: "Hello from {{business_name}}", choices: ["Choose food", "Help"] }];
  assert.equal(previewMessages(buttons, "My Cafe")[0].text, "Hello from My Cafe");
  assert.deepEqual(previewMessages(buttons, "My Cafe")[0].choices, ["Choose food", "Help"]);
  assert.equal(previewMessages([{ type: "list", text: "Menu", choices: ["Food"] }], "Cafe")[0].kind, "list");
  assert.equal(previewMessages([{ type: "location", text: "Where?" }], "Cafe")[0].kind, "location");
  assert.deepEqual(previewMessages([{ type: "handoff" }, { type: "tag", value: "x" }, { type: "delay", minutes: 2 }], "Cafe"), []);
  assert.equal(previewMessages([{ type: "payment_link" }], "Cafe")[0].kind, "url");
  assert.equal(previewMessages([{ type: "template", templateId: "approved", parameters: ["Alex"] }], "Cafe", [{ id: "approved", body: "Hi {{1}} from {{business_name}}" }])[0].text, "Hi Alex from Cafe");
  assert.equal(previewText("Order {{order_id}} {{unknown}}", "Cafe"), "Order #1024 {{unknown}}");
  const simulator = h.load("app/admin/components/automations/chat-simulator.ts");
  const welcomeChat = simulator.initialChat("welcome", "Demo Restaurant", [], true);
  assert.equal(welcomeChat[0].from, "customer");
  assert.equal(simulator.continueChat({ id: "more-items", label: "More Items" })[1].kind, "menu");
  for (const file of ["app/admin/components/automations/chat-simulator.ts", "app/admin/components/automations/whatsapp-preview.tsx"]) {
    const source = fs.readFileSync(file, "utf8").toLowerCase();
    for (const prohibited of ["firestore", "firebase", "router.push", "useRouter", "fetch(", "api/", "next/link"])
      assert.equal(source.includes(prohibited), false, `${file} must remain local-only: ${prohibited}`);
  }
  console.log("PASS builder previews render actions and the selected template locally");

  // 6. A business-built automation still runs through the real engine for Motos.
  const live = createHarness({ seedFixtures: false });
  const phone = "919999999999", customerId = `motos_${phone}`;
  live.seed("businesses/motos", { ...demoBusiness, vertical: "motos", name: "Demo Motors" });
  live.seed(`customers/${customerId}`, { businessId: "motos", phone, name: "Asha" });
  live.seed(`whatsapp_identities/${phone}`, { phone, linked: true, uid: "PRIVATE_UID" });
  live.seed(`conversations/${customerId}`, { businessId: "motos", customerPhone: phone, vertical: "motos", status: "active", state: "motos_start", context: { bookingId: "b1", orderId: "o1" } });
  live.seed("bookings/b1", { businessId: "motos", customerPhone: phone, vertical: "motos", bookingDate: "2026-11-01", startTime: "10:30", status: "confirmed", amount: 250 });
  live.seed("orders/o1", { businessId: "motos", customerPhone: phone, status: "confirmed", total: 250 });
  live.seed("messages/incoming", { businessId: "motos", customerPhone: phone, direction: "incoming", createdAt: live.Timestamp.now() });
  const svc = live.load("lib/automations/service.ts");
  const id = await svc.saveAutomation("motos", undefined, {
    name: "Greeting", description: "", trigger: { type: "customer.message.received" }, conditions: [],
    actions: [{ type: "buttons", text: "Hi {{customer_name}}, welcome to {{business_name}}. Booking {{booking_date}} {{booking_time}}; INR {{amount}}.", choices: ["Browse Cars", "Book Test Drive"] }],
  });
  await svc.changeAutomation("motos", id, "publish");
  const inbound = live.load("lib/messaging/services/incoming-message-service.ts");
  await inbound.processIncomingMessage({ ...demoBusiness, id: "motos", vertical: "motos", name: "Demo Motors" }, { from: phone, id: "wamid.motos.hi", type: "text", text: { body: "Hi" } });
  assert.equal(live.sends.length, 1);
  assert.equal(live.sends[0].reply.body, "Hi Asha, welcome to Demo Motors. Booking 2026-11-01 10:30; INR 250.00.");
  console.log("PASS a business-built Motos automation runs through the real engine with resolved context");

  // 7. Without any automation, an inbound "Hi" still gets the product's conversational welcome.
  const flow = createHarness();
  const flowInbound = flow.load("lib/messaging/services/incoming-message-service.ts");
  const retailBusiness = { ...demoBusiness, id: "demo-retail", vertical: "retail", name: "Demo Retail" };
  flow.seed("businesses/demo-retail", retailBusiness);
  await flowInbound.processIncomingMessage(retailBusiness, { from: "919888888888", id: "wamid.retail.hi", type: "text", text: { body: "Hi" } });
  assert.equal(flow.sends.length, 1, "the inbound welcome replies without a template");
  assert.notEqual(flow.sends[0].type, "template");
  assert.ok(!JSON.stringify(flow.sends[0]).includes("\"template\":"), "no WhatsApp template is used for the inbound welcome");
  console.log("PASS inbound \"Hi\" still gets the conversational welcome without a WhatsApp template");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
