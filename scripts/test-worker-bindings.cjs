/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { createHarness } = require("./messaging-test-helpers.cjs");

async function main() {
  const h = createHarness({ seedFixtures: false });
  const bindings = h.load("worker/bindings.ts");
  const request = new Request("https://worker.test/incoming");
  const d1 = { prepare() { throw new Error("not used"); } };
  await bindings.withWorkerBindings(request, { D1: d1, MESSAGE_CLAIMS: { idFromName: () => "id", get: () => ({ fetch: async () => new Response() }) } }, async () => {
    assert.equal(bindings.d1For(request), d1);
    assert.equal(typeof bindings.messageClaimsFor(request).get, "function");
  });
  assert.throws(() => bindings.workerBindingsFor(request), /outside an active Worker request/);
  await bindings.withWorkerBindings(request, {}, async () => {
    assert.throws(() => bindings.d1For(request), /D1 binding is required/);
    assert.throws(() => bindings.messageClaimsFor(request), /MESSAGE_CLAIMS Durable Object binding is required/);
  });
  console.log("PASS: Worker bindings are request-scoped and missing bindings fail clearly.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
