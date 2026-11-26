/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

function main() {
  const directory = fs.readFileSync("lib/admin/postgres-directory.ts", "utf8");
  const services = fs.readFileSync("lib/admin/services.ts", "utf8");
  const operations = fs.readFileSync("app/admin/components/operations-page.tsx", "utf8");
  const workspace = fs.readFileSync("app/business/_components/load-business.ts", "utf8");
  const errorPage = fs.readFileSync("app/admin/error.tsx", "utf8");
  assert.match(directory, /from messaging_businesses b/i);
  assert.match(directory, /left join whatsapp_accounts/i);
  assert.match(directory, /whatsapp_conversations/i);
  assert.match(directory, /whatsapp_messages/i);
  assert.match(directory, /whatsapp_templates/i);
  assert.doesNotMatch(directory, /firebase-admin|adminDb|collection\(/i);
  assert.match(directory, /PostgresDirectoryError/);
  assert.match(services, /listPostgresBusinessProfiles/);
  assert.match(services, /listPostgresBusinesses/);
  assert.doesNotMatch(services.match(/export const listBusinessProfiles[\s\S]*?export async function listBusinesses/)[0], /adminDb\.collection\("businesses"/);
  assert.match(operations, /PostgresDirectoryOverview/);
  assert.match(operations, /businessId=\{businessId\}/);
  assert.match(workspace, /getPostgresBusinessProfile/);
  assert.match(workspace, /\["dual-write", "postgres"\]/);
  assert.match(errorPage, /Postgres dashboard data is unavailable/);
  console.log("PASS: Super Admin directory, account status, and overview use standalone Postgres without a Firestore fallback.");
}
try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
