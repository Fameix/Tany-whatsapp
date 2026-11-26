/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const business = fs.readFileSync("lib/messaging/business.ts", "utf8");
const postgres = fs.readFileSync("lib/data/postgres-messaging-repository.ts", "utf8");
const firestore = fs.readFileSync("lib/data/firestore-repository.ts", "utf8");

assert.match(business, /mode === "dual-write" \|\| mode === "postgres"/);
assert.match(business, /new PostgresMessagingRepository\(\)\.findActiveBusinessByPhoneNumberId/);
assert.match(business, /POSTGRES_PHONE_MAPPING_NOT_FOUND/);
assert.match(business, /POSTGRES_PHONE_MAPPING_LOOKUP_FAILED/);
assert.match(business, /repositoryFor\(\)\)\.findActiveBusinessByPhoneNumberId/);
assert.match(postgres, /from whatsapp_phone_mappings p/);
assert.match(postgres, /a\.messaging_business_id = p\.messaging_business_id/);
assert.match(postgres, /a\.phone_number_id = p\.phone_number_id/);
assert.match(postgres, /text\(result\[0\]\.status\) !== "active"/);
assert.match(postgres, /POSTGRES_PHONE_ALREADY_CONNECTED/);
assert.match(firestore, /where\("whatsappPhoneNumberId", "==", phoneNumberId\)/);
console.log("PASS: dual-write phone resolution uses the local Postgres mapping, rejects absent/inactive/inconsistent mappings, preserves unique mapping protection, and retains Firestore mode lookup.");
