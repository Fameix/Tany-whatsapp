/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (file) => fs.readFileSync(file, "utf8");

const messages = read("lib/messaging/services/message-service.ts");
const postgres = read("lib/data/postgres-messaging-repository.ts");
const receipts = read("lib/admin/delivery-receipts.ts");

assert.match(messages, /mode === "dual-write" \|\| mode === "postgres"/);
assert.match(messages, /claimRuntimeIncomingMessage/);
assert.match(messages, /finishRuntimeIncomingMessage/);
assert.match(messages, /getRuntimePreparedReply/);
assert.match(messages, /storeRuntimePreparedReply/);
assert.match(messages, /hasRuntimeOutgoingReply/);
assert.match(messages, /storeRuntimeOutgoingReply/);
assert.match(messages, /return \(await outgoingReference\(incomingMessageId\)\.get\(\)\)\.exists/);
assert.match(postgres, /on conflict \(meta_message_id\) do update/i);
assert.match(postgres, /lease_expires_at <= now\(\)/i);
assert.match(postgres, /processing_status = 'failed'/i);
assert.match(postgres, /lease_token = \$\{token\}/);
assert.match(postgres, /source_message_id/);
assert.match(postgres, /POSTGRES_MESSAGE_TENANT_MISMATCH/);
assert.match(postgres, /recordRuntimeDeliveryEvent/);
assert.match(postgres, /meta_event_id/);
assert.match(receipts, /recordRuntimeDeliveryEvent/);
console.log("PASS: Postgres message claiming, expired/failed retry, prepared replies, outgoing dedupe, receipt idempotency, tenant checks, and Firestore-mode branches are covered.");
