/* eslint-disable @typescript-eslint/no-require-imports */
// Template library: starter definitions, Meta rules, tenant isolation and the
// Draft → In review → Approved/Rejected lifecycle against staging Postgres.
// Meta and Secret Manager are mocked; no request leaves this process.
const fs = require("node:fs");

async function main() {
  const assert = (await import("node:assert/strict")).default;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  Object.assign(process.env, { MESSAGING_DATABASE: "postgres", MESSAGING_POSTGRES_TARGET: "staging", WHATSAPP_TOKEN_SECRET_PROJECT: "tany-whatsapp" });
  assert.ok(!/prod|production|live/i.test(new URL(process.env.DATABASE_URL).hostname), "staging database only");

  const model = await import("../lib/templates/model.ts");
  const { startersFor, findStarter } = await import("../lib/templates/starters.ts");

  // 1. Starters: product-scoped, valid for Meta once URLs are filled, never authentication.
  const counts = { retail: 13, eats: 13, motos: 14 };
  const keys = new Set();
  for (const [product, expected] of Object.entries(counts)) {
    const starters = startersFor(product);
    assert.equal(starters.length, expected, `${product} starter count`);
    for (const starter of starters) {
      assert.ok(starter.key.startsWith(`${product}_`), `${starter.key} belongs to ${product}`);
      assert.ok(!keys.has(starter.key), `${starter.key} is unique`); keys.add(starter.key);
      assert.notEqual(starter.category, "authentication");
      const content = { ...model.emptyTemplate(), name: starter.name, category: starter.category, body: starter.body, examples: starter.examples,
        buttons: starter.buttons.map(button => button.type === "URL" ? { ...button, url: "https://example.com/x" } : button) };
      assert.deepEqual(model.validateTemplate(content), [], `${starter.key} passes Meta's structural rules`);
      assert.equal(starter.examples.length, model.templateVariables(starter.body).length, `${starter.key} has one example per variable`);
      assert.ok(model.isSendableWithBodyParameters(model.metaComponents(content)), `${starter.key} is sendable with body parameters once approved`);
    }
  }
  assert.equal(startersFor("cabs").length, 0, "products without a library get none");
  assert.equal(findStarter("eats", "retail_order_confirmed"), null, "Eats cannot copy a Retail starter");
  assert.ok(findStarter("retail", "retail_order_confirmed"));
  const urlStarter = findStarter("retail", "retail_order_confirmed");
  assert.ok(model.validateTemplate({ ...model.emptyTemplate(), ...urlStarter }).some(issue => issue.field === "buttons"), "website buttons need a real link before submission");
  console.log("PASS Retail 13, Eats 13, Motos 14 product-scoped starters; all valid for Meta; no authentication starters");

  // Welcome is the first starter for each product: Marketing, quick replies only, featured.
  const welcomes = {
    retail: { business: "Tany Retail", replies: ["Shop products", "Track order", "Offers", "Talk to us"] },
    eats: { business: "Tany Eats", replies: ["View menu", "Track order", "Offers", "Support"] },
    motos: { business: "Tany Motos", replies: ["Browse vehicles", "Book test drive", "Check availability", "Talk to dealer"] },
  };
  for (const [product, expected] of Object.entries(welcomes)) {
    const starters = startersFor(product);
    const [first] = starters;
    assert.equal(first.key, `${product}_welcome`, `${product} starts with its Welcome template`);
    assert.equal(first.title, "Welcome");
    assert.equal(first.category, "marketing");
    assert.equal(first.featured, true, "Welcome is featured so it renders first");
    assert.deepEqual(starters.filter(s => s.featured).map(s => s.key), [`${product}_welcome`], "only Welcome is featured");
    assert.deepEqual(first.examples, ["Priya", expected.business]);
    assert.deepEqual(first.buttons, expected.replies.map(text => ({ type: "QUICK_REPLY", text })), "suggested quick replies, no links to fill");
    assert.match(first.body, /^Hi \{\{1\}\} 👋\n\nWelcome to \{\{2\}\}\./);
    assert.deepEqual(model.validateTemplate({ ...model.emptyTemplate(), ...first }), [], `${first.key} is submittable as-is`);
  }
  console.log("PASS Welcome is the first, featured Marketing starter for Retail, Eats and Motos and submittable as-is");

  // 2. Meta rules and payload.
  const base = { ...model.emptyTemplate(), name: "order_update", body: "Hi {{1}}, order {{2}} is ready.", examples: ["Asha", "A1"] };
  assert.deepEqual(model.validateTemplate(base), []);
  const fields = (content) => model.validateTemplate(content).map(issue => issue.field);
  assert.ok(fields({ ...base, body: "Hi {{1}}, order {{3}} is ready." }).includes("body"), "gaps in numbering are rejected");
  assert.ok(fields({ ...base, body: "{{1}}, your order is ready." }).includes("body"), "leading variable is rejected");
  assert.ok(fields({ ...base, body: "Your order is ready {{1}}" }).includes("body"), "trailing variable is rejected");
  assert.ok(fields({ ...base, examples: ["Asha", ""] }).includes("examples"), "every variable needs an example");
  assert.ok(fields({ ...base, name: "Order Update" }).includes("name"));
  assert.ok(fields({ ...base, header: "Hi {{1}}" }).includes("header"));
  assert.ok(fields({ ...base, category: "authentication" }).includes("category"), "authentication cannot be authored yet");
  const components = model.metaComponents({ ...base, header: "Update", footer: "Tany", buttons: [{ type: "QUICK_REPLY", text: "Thanks" }] });
  assert.deepEqual(components.map(c => c.type), ["HEADER", "BODY", "FOOTER", "BUTTONS"]);
  assert.deepEqual(components[1].example, { body_text: [["Asha", "A1"]] }, "submission includes review examples");
  assert.equal(model.isSendableWithBodyParameters([{ type: "HEADER", format: "IMAGE" }]), false, "media headers need parameters the senders can't supply");
  assert.equal(model.isSendableWithBodyParameters([{ type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.example/{{1}}" }] }]), false, "dynamic URL buttons are not sendable");
  for (const status of ["", "PENDING", "IN_APPEAL", "LIMIT_EXCEEDED", "approved?"]) assert.notEqual(model.statusFromMeta(status), "approved", `"${status}" never becomes approved`);
  assert.equal(model.statusFromMeta("APPROVED"), "approved");
  assert.equal(model.statusFromMeta("PAUSED"), "rejected");
  console.log("PASS Meta structural rules, review examples in the payload, and only Meta's APPROVED maps to approved");

  // 3. Staging: starter → draft, tenant isolation, lifecycle, live-sending gates.
  const repo = await import("../lib/templates/repository.ts");
  const { postgresDb } = await import("../lib/data/postgres-client.ts");
  const { sql } = await import("drizzle-orm");
  const credentials = await import("../lib/whatsapp/credentials.ts");
  const meta = await import("../lib/templates/meta-templates.ts");
  const { automationPersistence } = await import("../lib/automations/persistence.ts");
  const { createCampaignDraft } = await import("../lib/admin/operations-service.ts");
  const suffix = Date.now().toString(36);
  const created = [];
  const originalFetch = globalThis.fetch;
  try {
    const starter = findStarter("retail", "retail_order_confirmed");
    const draftContent = { ...model.emptyTemplate(), name: `zz_test_${suffix}`, category: starter.category, body: starter.body, examples: [...starter.examples], buttons: [{ type: "URL", text: "Track order", url: "https://example.com/track" }, { type: "QUICK_REPLY", text: "Contact store" }] };
    const id = await repo.createBusinessTemplate("test-retail", draftContent, { starterKey: starter.key, product: "retail" });
    created.push(["test-retail", id]);
    const draft = await repo.getBusinessTemplate("test-retail", id);
    assert.equal(draft.status, "draft", "a copied starter is a draft, never approved");
    assert.equal(draft.starterKey, "retail_order_confirmed");
    assert.equal(draft.metaTemplateId, null);
    assert.deepEqual(draft.examples, starter.examples);
    assert.ok(startersFor("retail").find(s => s.key === starter.key).buttons.every(button => button.type !== "URL" || button.url === ""), "the global starter is not modified");
    await assert.rejects(repo.createBusinessTemplate("test-retail", draftContent), repo.TemplateNameTakenError, "duplicate name and language is rejected");
    console.log("PASS starter → business-owned draft; global starter untouched; duplicate names rejected");

    assert.equal(await repo.getBusinessTemplate("test-eats", id), null, "another tenant cannot read the draft");
    assert.ok(!(await repo.listBusinessTemplates("test-eats")).some(template => template.id === id), "another tenant's list excludes it");
    await assert.rejects(repo.updateBusinessTemplate("test-eats", id, { status: "approved" }), /TEMPLATE_NOT_FOUND/, "another tenant cannot update it");
    await repo.deleteBusinessTemplate("test-eats", id);
    assert.ok(await repo.getBusinessTemplate("test-retail", id), "another tenant cannot delete it");
    console.log("PASS tenant isolation: test-eats cannot read, list, update or delete test-retail's template");

    // Live senders and campaigns refuse anything not approved.
    const asSender = await automationPersistence().get("templates", "test-retail", id);
    assert.equal(asSender.status, "draft");
    assert.equal(asSender.components.length, 2, "stored components are what the senders read");
    await assert.rejects(createCampaignDraft("test-retail", { name: "t", template: id, audience: "all" }, true), /approved Marketing template/, "a draft cannot be used in a campaign");

    // Submission: mocked Secret Manager credential and Meta Graph API.
    credentials.installWhatsAppSecretManagerAdapter(async () => ({ readSecret: async () => `EAAG${"t".repeat(40)}`, writeSecret: async () => { throw new Error("not used"); } }));
    const graphCalls = [];
    let reviewResult = { status: "PENDING" };
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url instanceof Request ? url.url : url);
      // The Neon driver queries staging Postgres over HTTPS; everything else must be Graph.
      if (new URL(target).hostname.endsWith(".neon.tech")) return originalFetch(url, init);
      if (!target.startsWith("https://graph.facebook.com/")) throw new Error(`unexpected request ${target}`);
      graphCalls.push({ target, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
      if (target.includes("/message_templates")) return Response.json({ id: "9900000000001", status: "PENDING", category: "UTILITY" });
      if (target.includes("9900000000001?fields=")) return Response.json(reviewResult);
      if (target.endsWith("/9900000000001")) return Response.json({ success: true });
      throw new Error(`unexpected Graph call ${target}`);
    };
    const submitted = await meta.submitTemplateToMeta("test-retail", id);
    assert.equal(submitted.status, "pending", "submission puts the template in review, not approved");
    assert.equal(submitted.metaTemplateId, "9900000000001");
    const create = graphCalls.find(call => call.target.includes("/message_templates"));
    assert.equal(create.method, "POST");
    assert.match(create.target, /\/\d+\/message_templates$/, "submits to this business's own WABA");
    assert.deepEqual(create.body.components.find(c => c.type === "BODY").example.body_text, [starter.examples]);
    assert.equal(create.body.category, "UTILITY");
    await assert.rejects(meta.submitTemplateToMeta("test-retail", id), /Only drafts and rejected/, "a template in review cannot be resubmitted");
    await assert.rejects(createCampaignDraft("test-retail", { name: "t", template: id, audience: "all" }, true), /approved Marketing template/, "a template in review cannot be used in a campaign");

    reviewResult = { status: "REJECTED", rejected_reason: "INVALID_FORMAT", category: "UTILITY" };
    const rejected = await meta.refreshTemplateStatus("test-retail", id);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectionReason, "INVALID_FORMAT", "Meta's rejection reason is kept");
    const resubmitted = await meta.submitTemplateToMeta("test-retail", id);
    assert.equal(resubmitted.status, "pending");
    assert.ok(graphCalls.some(call => call.target.endsWith("/9900000000001") && call.method === "POST"), "a rejected template is edited in place on Meta");
    assert.equal(resubmitted.rejectionReason, null);

    reviewResult = { status: "APPROVED", category: "UTILITY" };
    const approved = await meta.refreshTemplateStatus("test-retail", id);
    assert.equal(approved.status, "approved", "approved only after Meta says so");
    assert.equal((await automationPersistence().get("templates", "test-retail", id)).status, "approved", "senders now see it as approved");
    await assert.rejects(createCampaignDraft("test-retail", { name: "t", template: id, audience: "all" }, true), /approved Marketing template/, "an approved Utility template is not a campaign template");
    assert.ok(graphCalls.every(call => call.auth === `Bearer EAAG${"t".repeat(40)}`), "uses the business's own credential");
    console.log("PASS lifecycle Draft → In review → Rejected (reason kept) → resubmitted → Approved, driven only by Meta; campaigns need approved Marketing");
  } finally {
    globalThis.fetch = originalFetch;
    credentials.installWhatsAppSecretManagerAdapter(undefined);
    for (const [businessId, id] of created)
      await postgresDb().execute(sql`delete from whatsapp_templates where legacy_template_id = ${id} and messaging_business_id = (select id from messaging_businesses where legacy_business_id = ${businessId})`);
    const left = await postgresDb().execute(sql`select count(*)::int as n from whatsapp_templates where name like ${`zz_test_${suffix}%`}`);
    assert.equal(left.rows[0].n, 0, "test templates are cleaned up");
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
