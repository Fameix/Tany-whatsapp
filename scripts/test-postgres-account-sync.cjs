/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("scripts/sync-demo-retail-postgres-account.ts", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.match(source, /collection\("whatsapp_accounts"\)\.doc\(businessId\)/);
assert.match(source, /new PostgresMessagingRepository\(\)\.mirrorAccount/);
assert.match(source, /isAllowedTokenSecretName\(tokenSecretName, businessId\)/);
assert.match(source, /MESSAGING_POSTGRES_TARGET !== "staging"/);
assert.match(source, /Allowlist only/);
assert.doesNotMatch(source, /source\.accessToken|source\.access_token|source\.token\b/);
assert.match(packageJson.scripts["db:postgres:sync-demo-retail-account"], /--conditions=react-server/);
console.log("PASS: demo-retail sync allowlists metadata, validates the secret reference, and delegates idempotent account/mapping writes to Postgres.");
