/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");

async function main() {
  loadEnvConfig(process.cwd());
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tenant = await client.query("select id, legacy_business_id, name, vertical, status from messaging_businesses where legacy_business_id = $1", ["demo-retail"]);
    const tables = await client.query("select count(1)::int as count from information_schema.tables where table_schema = $1 and table_name = any($2)", ["public", ["messaging_businesses", "whatsapp_accounts", "whatsapp_phone_mappings", "whatsapp_contacts", "whatsapp_conversations", "whatsapp_messages", "whatsapp_message_events", "whatsapp_templates", "whatsapp_automation_state", "whatsapp_webhook_events", "automation_definitions", "automation_events", "automation_runs", "automation_states"]]);
    console.log(JSON.stringify({ tenant: tenant.rows[0], tableCount: tables.rows[0].count }));
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
