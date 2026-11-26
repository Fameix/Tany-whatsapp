/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness } = require("./messaging-test-helpers.cjs");

class Storage { constructor() { this.values = new Map(); } async get(k) { return this.values.get(k); } async put(k, v) { this.values.set(k, v); } }
const call = (coordinator, body) => coordinator.fetch(new Request("https://claims", { method: "POST", body: JSON.stringify(body) }));
async function main() {
  const h = createHarness({ seedFixtures: false });
  const { MessageClaimCoordinator } = h.load("worker/message-claim-coordinator.ts");
  const storage = new Storage(); const coordinator = new MessageClaimCoordinator({ storage });
  const [first, second] = await Promise.all([call(coordinator, { action: "claim", businessId: "eats", messageId: "m1" }), call(coordinator, { action: "claim", businessId: "eats", messageId: "m1" })]);
  const results = await Promise.all([first.json(), second.json()]);
  assert.equal(results.filter(r => r.claimed).length, 1, "concurrent duplicate has one winner");
  const winner = results.find(r => r.claimed);
  await call(coordinator, { action: "finish", businessId: "eats", token: winner.token, status: "processed" });
  assert.equal((await (await call(coordinator, { action: "claim", businessId: "eats", messageId: "m1" })).json()).claimed, false, "completed duplicates remain idempotent");
  assert.equal((await call(coordinator, { action: "claim", businessId: "motos", messageId: "m1" })).status, 403, "claims cannot cross business scope");
  const stored = await storage.get("claim"); stored.status = "received"; stored.leaseUntil = Date.now() - 1; await storage.put("claim", stored);
  assert.equal((await (await call(coordinator, { action: "claim", businessId: "eats", messageId: "m1" })).json()).claimed, true, "expired unfinished claims can retry");
  console.log("PASS: Durable Object claim serialization, expiry, completion, and tenant isolation.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
