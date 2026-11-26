/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness, demoBusiness } = require("./messaging-test-helpers.cjs");

async function main() {
  const h = createHarness({ linkedIdentity: false });
  const business = { ...demoBusiness, id: "demo-retail", vertical: "retail", name: "Demo Retail" };
  const phone = "919999999999";
  h.seed("businesses/demo-retail", business);
  const processIncomingMessage = h.load("lib/messaging/services/incoming-message-service.ts").processIncomingMessage;
  const result = await processIncomingMessage(business, { from: phone, id: "wamid.retail-hi", type: "text", text: { body: "Hi" } });
  assert.equal(result.success, true);
  const choices = result.structuredReply?.type === "buttons" ? result.structuredReply.buttons : result.structuredReply?.type === "list" ? result.structuredReply.sections.flatMap(section => section.rows) : [];
  assert.deepEqual(choices.map(choice => choice.title), ["Shop Products", "Track Order", "Offers", "Support"]);
  assert.match(result.structuredReply.body, /Welcome to Demo Retail/);
  assert.equal(h.sends[0].reply.type, "list");
  assert.equal([...h.documents.keys()].filter(key => key.startsWith("whatsapp_link_sessions/")).length, 0);

  const action = async (id, title, messageId) => processIncomingMessage(business, {
    from: phone, id: messageId, type: "interactive",
    interactive: { type: "list_reply", list_reply: { id, title } },
  });
  const support = await action("retail_menu_support", "Support", "wamid.retail-support");
  assert.equal(support.structuredReply.type, "buttons");
  const offers = await action("retail_menu_offers", "Offers", "wamid.retail-offers");
  assert.ok(["buttons", "list"].includes(offers.structuredReply.type));
  const tracking = await action("retail_menu_track", "Track Order", "wamid.retail-track");
  assert.equal(tracking.skipped, "account_link_required");
  assert.equal(h.sends.at(-1).reply.type, "cta_url");
  assert.equal([...h.documents.keys()].filter(key => key.startsWith("whatsapp_link_sessions/")).length, 1);
  console.log("PASS: anonymous demo-retail Hi → tenant welcome and Retail menu; identity requested only for Track Order.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
