/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');

async function main() {
  loadEnvConfig(process.cwd());
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL is required.');
  const url = new URL(rawUrl);
  if (process.env.MESSAGING_POSTGRES_TARGET !== 'staging' || /prod|production|live/.test(`${url.hostname}${url.pathname}`.toLowerCase())) throw new Error('Refusing to seed: set MESSAGING_POSTGRES_TARGET=staging and use a non-production DATABASE_URL.');
  const client = new Client({ connectionString: rawUrl });
  await client.connect();
  try {
    const result = await client.query(`
      insert into messaging_businesses (legacy_business_id, name, vertical, status)
      values ($1, $2, $3, $4)
      on conflict (legacy_business_id) do update
      set name = excluded.name, vertical = excluded.vertical, status = excluded.status, updated_at = now()
      returning id
    `, ['demo-retail', 'Demo Retail', 'retail', 'active']);
    console.log(`Demo Retail messaging business UUID: ${result.rows[0].id}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
