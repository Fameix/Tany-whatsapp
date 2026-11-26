/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function main() {
  const persistence = read("lib/automations/persistence.ts");
  const postgres = read("lib/automations/postgres-persistence.ts");
  const service = read("lib/automations/service.ts");
  const engine = read("lib/automations/automation-engine.ts");
  const worker = read("lib/automations/worker.ts");
  const events = read("lib/automations/events.ts");
  const schema = read("lib/data/postgres-schema.ts");
  const backfill = read("scripts/backfill-demo-retail-dual-write.ts");

  assert.match(persistence, /mode === "postgres"[^;]+PostgresAutomationPersistence/);
  assert.match(persistence, /mode === "dual-write"[^;]+DualWriteAutomationPersistence\(new PostgresAutomationPersistence\(\), firestore\)/);
  assert.match(persistence, /list\(table[\s\S]+return this\.primary\.list/);
  assert.doesNotMatch(persistence, /catch[\s\S]{0,160}this\.primary\.get/);
  for (const table of ["automation_definitions", "automation_events", "automation_runs", "automation_states", "whatsapp_templates"])
    assert.match(schema, new RegExp(`\\"${table}\\"`));
  for (const source of [service, engine, worker, events]) assert.match(source, /automationPersistence/);
  assert.doesNotMatch(engine, /collection\("automations"\)|collection\("automation_runs"\)|collection\("templates"\)/);
  assert.doesNotMatch(worker, /collection\("automation_events"\)|collection\("automation_runs"\)|collection\("automations"\)|automation_scheduler_cursors/);
  assert.match(postgres, /on conflict \(id\) do nothing returning id/);
  assert.match(backfill, /backfillRows\("automations"/);
  assert.match(backfill, /backfillRows\("templates"/);

  loadEnvConfig(root);
  const connectionString = process.env.MESSAGING_POSTGRES_URL || process.env.DATABASE_URL;
  let counts = null;
  if (connectionString && process.env.MESSAGING_POSTGRES_TARGET === "staging") {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const result = await client.query(`select
        (select count(*) from automation_definitions a where a.messaging_business_id=b.id)::int automations,
        (select count(*) from automation_events a where a.messaging_business_id=b.id)::int events,
        (select count(*) from automation_runs a where a.messaging_business_id=b.id)::int runs,
        (select count(*) from automation_states a where a.messaging_business_id=b.id)::int states,
        (select count(*) from whatsapp_templates t where t.messaging_business_id=b.id)::int templates
        from messaging_businesses b where legacy_business_id=$1`, ["demo-retail"]);
      assert.equal(result.rowCount, 1, "demo-retail must be mapped in Postgres");
      counts = result.rows[0];
      assert.ok(counts.automations >= 1);
      assert.ok(counts.templates >= 1);
    } finally { await client.end(); }
  }
  console.log(`PASS: Postgres-authoritative automation/template routing, no read fallback, idempotent claims/backfill, and demo-retail rows${counts ? ` ${JSON.stringify(counts)}` : ""}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
