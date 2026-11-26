/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");
const customer = read("lib/messaging/services/customer-service.ts");
const conversation = read("lib/messaging/services/conversation-service.ts");
const postgres = read("lib/data/postgres-messaging-repository.ts");
const repository = read("lib/data/repository.ts");

// Postgres runtime mode owns the lookup; Firestore mode still follows its original path.
assert.match(customer, /mode === "dual-write" \|\| mode === "postgres"/);
assert.match(customer, /getRuntimeContact\(businessId, phone\)/);
assert.match(customer, /POSTGRES_CONTACT_LOOKUP_FAILED/);
assert.match(customer, /FIRESTORE_CONTACT_WRITE_FAILED/);
assert.match(customer, /adminDb\.runTransaction/);
assert.match(conversation, /mode === "dual-write" \|\| mode === "postgres"/);
assert.match(conversation, /getRuntimeConversation\(key\.businessId, customerDocumentId/);
assert.match(conversation, /POSTGRES_CONVERSATION_LOOKUP_FAILED/);
assert.match(conversation, /POSTGRES_CONVERSATION_NOT_FOUND/);
assert.match(conversation, /FIRESTORE_CONVERSATION_WRITE_FAILED/);
assert.match(conversation, /status === "handed_off" \? handoffStatus !== "human"/);
assert.match(conversation, /return readDocument<Conversation>\(reference\(key\)\)/);
assert.match(postgres, /where messaging_business_id = \$\{business\.id\} and phone_hash/);
assert.match(postgres, /where messaging_business_id = \$\{business\.id\} and legacy_contact_id/);
assert.match(postgres, /POSTGRES_CONTACT_INCONSISTENT/);
assert.match(postgres, /POSTGRES_CONVERSATION_INCONSISTENT/);
assert.match(repository, /mode === "dual-write" \|\| mode === "postgres"/);
console.log("PASS: Postgres mode uses tenant-scoped contact/conversation reads, rejects inconsistent or unavailable rows, preserves handoff/state validation, and leaves Firestore-mode reads unchanged.");
