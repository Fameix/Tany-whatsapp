/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHarness } = require("./messaging-test-helpers.cjs");

async function main() {
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
  assert.match(errorPage, /Business data is temporarily unavailable/);
  const workspaceError = fs.readFileSync("app/business/[businessId]/error.tsx", "utf8");
  assert.doesNotMatch(errorPage + workspaceError, /Firestore|Postgres/i);

  const originalMode = process.env.MESSAGING_DATABASE;
  try {
    const h = createHarness({ seedFixtures: false });
    const postgres = h.load("lib/admin/postgres-directory.ts");
    const services = h.load("lib/admin/services.ts");
    const business = { id: "fixture", name: "Fixture", vertical: "eats", active: true, whatsappPhoneNumberId: "", settings: {} };
    const directoryItem = { ...business, catalogCount: 0 };
    postgres.listPostgresBusinessProfiles = async () => [business];
    postgres.listPostgresBusinesses = async () => [directoryItem];

    process.env.MESSAGING_DATABASE = "postgres";
    const collection = h.adminDb.collection;
    let firestoreReads = 0;
    h.adminDb.collection = () => {
      firestoreReads++;
      throw new Error("Unexpected Firestore access");
    };
    assert.deepEqual(await services.listBusinessProfiles(), [business]);
    assert.deepEqual(await services.listBusinesses(), [directoryItem]);
    const failure = new postgres.PostgresDirectoryError();
    postgres.listPostgresBusinessProfiles = async () => { throw failure; };
    postgres.listPostgresBusinesses = async () => { throw failure; };
    await assert.rejects(services.listBusinessProfiles(), (error) => error === failure);
    await assert.rejects(services.listBusinesses(), (error) => error === failure);
    assert.equal(firestoreReads, 0);

    process.env.MESSAGING_DATABASE = "firestore";
    h.adminDb.collection = collection;
    h.seed("businesses/fixture", business);
    assert.deepEqual(await services.listBusinessProfiles(), [business]);
    assert.deepEqual(await services.listBusinesses(), [directoryItem]);
  } finally {
    if (originalMode === undefined) delete process.env.MESSAGING_DATABASE;
    else process.env.MESSAGING_DATABASE = originalMode;
  }
  console.log("PASS: Super Admin directory, account status, and overview use standalone Postgres without a Firestore fallback.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
