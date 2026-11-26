/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");

async function main() {
  loadEnvConfig(process.cwd());
  const [phone, businessId, ...nameParts] = process.argv.slice(2);
  const displayName = nameParts.join(" ").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phone ?? "") || !businessId || businessId.length > 1500) throw new Error("Usage: node scripts/provision-phone-login.cjs +E164 business-id [display name]");
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.MESSAGING_POSTGRES_TARGET !== "staging") throw new Error("Refusing to provision: explicit MESSAGING_POSTGRES_TARGET=staging and DATABASE_URL are required.");
  const url = new URL(raw);
  if (/prod|production|live/i.test(`${url.hostname}${url.pathname}`)) throw new Error("Refusing production database target.");
  const client = new Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query("begin");
    const business = await client.query("select id from messaging_businesses where legacy_business_id=$1", [businessId]);
    if (!business.rowCount) throw new Error("Business is not present in the staging Messaging directory.");
    const user = await client.query("insert into messaging_auth_users(phone,display_name) values($1,$2) on conflict(phone) do update set display_name=case when excluded.display_name='' then messaging_auth_users.display_name else excluded.display_name end,updated_at=now() returning id", [phone, displayName]);
    await client.query("insert into messaging_auth_user_businesses(user_id,messaging_business_id) values($1,$2) on conflict(user_id,messaging_business_id) do nothing", [user.rows[0].id, business.rows[0].id]);
    await client.query("commit");
    console.log(JSON.stringify({ provisioned: true, phone, businessId }));
  } catch (error) { await client.query("rollback"); throw error; }
  finally { await client.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
