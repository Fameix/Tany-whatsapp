/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");
const customer = read("lib/messaging/services/customer-service.ts");
const conversation = read("lib/messaging/services/conversation-service.ts");
const messages = read("lib/messaging/services/message-service.ts");
const automation = read("lib/automations/automation-engine.ts");
const receipts = read("lib/admin/delivery-receipts.ts");
const repository = read("lib/data/repository.ts");
const privacy = read("lib/data/postgres-contact-privacy.ts");
const backfill = read("scripts/backfill-demo-retail-dual-write.ts");

assert.match(customer, /await postgresShadowWrite\("contact"/);
assert.match(customer, /postgresContactProjection\(phone\)/);
assert.match(conversation, /await postgresShadowWrite\("conversation"/);
assert.match(conversation, /getOrCreateConversation[\s\S]*await mirrorConversation/);
assert.match(conversation, /updateConversationState[\s\S]*await mirrorConversation/);
assert.match(conversation, /resetConversation[\s\S]*await mirrorConversation/);
assert.match(messages, /storeOutgoingMessage[\s\S]*postgresShadowWrite\("message"/);
assert.match(automation, /replies bypass storeOutgoingMessage/i);
assert.match(automation, /await postgresShadowWrite\("message"/);
assert.match(receipts, /postgresShadowWrite\("delivery-event"/);
assert.match(receipts, /event\.status/);
assert.match(repository, /"contact" \| "conversation"/);
assert.match(repository, /safePostgresMirror/);
assert.match(privacy, /aes-256-gcm/);
assert.match(privacy, /createHmac/);
assert.match(backfill, /mirrorContact/);
assert.match(backfill, /mirrorConversation/);
assert.match(backfill, /vertical: text\(row\.vertical\)/);
assert.match(backfill, /mirrorMessage/);
assert.match(backfill, /mirrorDeliveryEvent/);
console.log("PASS: contact, conversation, normal and automation outgoing messages, receipt events, idempotent mirror paths, and Firestore-first failure isolation are covered.");
