/* eslint-disable @typescript-eslint/no-require-imports */
// WhatsApp sign-in code diagnostics: each send is recorded in Message Status by Meta's message id with
// the label "Sign-in code (<template>)" (never the code); delivery receipts keep Meta's failure reason
// (code · title · details) and Message Status shows it; logs carry only the message id and status.
const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  const { deliveryErrorFrom, formatDeliveryError } = await import("../lib/whatsapp/delivery-error.ts");
  const failed = { id: "wamid.X", status: "failed", timestamp: "1795851986", errors: [{ code: 131042, title: "Business eligibility payment issue", message: "Business eligibility payment issue", error_data: { details: "Message failed to send because there were one or more errors related to your payment method." } }] };
  const error = deliveryErrorFrom(failed);
  assert.deepEqual(error, { code: 131042, title: "Business eligibility payment issue", details: "Message failed to send because there were one or more errors related to your payment method." });
  assert.equal(formatDeliveryError(error), "131042 · Business eligibility payment issue · Message failed to send because there were one or more errors related to your payment method.");
  assert.equal(formatDeliveryError({ code: 131026, title: "Message undeliverable", details: "Message undeliverable" }), "131026 · Message undeliverable", "details repeating the title are not duplicated");
  assert.deepEqual(deliveryErrorFrom({ errors: [{ message: "Something", error_data: {} }] }), { code: null, title: "Something", details: "" });
  for (const none of [{ status: "failed" }, { errors: [] }, { errors: [{}] }, null, { errors: "x" }]) assert.equal(deliveryErrorFrom(none), null);
  assert.equal(deliveryErrorFrom({ errors: [{ code: 1, title: "x".repeat(900), error_data: { details: "y".repeat(900) } }] }).title.length, 200, "Meta's text is length-limited");
  console.log("PASS Meta's failure code, title and details are extracted and formatted; missing or malformed errors are ignored");

  const otp = fs.readFileSync("lib/auth/whatsapp-otp.ts", "utf8");
  assert.match(otp, /console\.info\("\[WHATSAPP_OTP_SENT\]", \{ messageId, status: "sent" \}\);/, "the send log carries only the message id and status");
  assert.match(otp, /storeSignInCodeMessage\(sender\.businessId, \{ messageId, phone, template: sender\.template\.name \}\)/, "the send is recorded by message id, without the code");
  for (const line of otp.split("\n").filter(line => /console\.\w+\(/.test(line))) assert.doesNotMatch(line, /[^.\w]code\b/, `no log includes the code: ${line.trim()}`);
  const repo = fs.readFileSync("lib/data/postgres-messaging-repository.ts", "utf8");
  const store = repo.slice(repo.indexOf("async storeSignInCodeMessage"), repo.indexOf("Phase 3 message state"));
  assert.match(store, /const label = `Sign-in code \(\$\{input\.template\}\)`;/);
  assert.match(store, /input: \{ messageId: string; phone: string; template: string \}/, "the stored row cannot receive the code");
  assert.match(store, /'outgoing', 'template', \$\{label\}/);
  assert.match(repo, /failure_reason = coalesce\(\$\{failure\}, failure_reason\)/, "a failed receipt stores Meta's reason on the message");
  assert.match(repo, /failureReason: text\(row\.failure_reason\)/);
  const receipts = fs.readFileSync("lib/admin/delivery-receipts.ts", "utf8");
  assert.match(receipts, /const error = event\.status === "failed" \? deliveryErrorFrom\(event\) : null;/);
  assert.match(receipts, /console\.info\("\[WHATSAPP_DELIVERY_STATUS\]", \{ messageId: event\.id, status: event\.status, errorCode: error\?\.code \?\? null \}\);/, "the status log carries only id, status and Meta's code");
  assert.match(fs.readFileSync("lib/admin/operations-service.ts", "utf8"), /str\(data\.failureReason, 800\) \|\| "Processing or delivery failed/, "Message Status shows Meta's reason");
  assert.match(fs.readFileSync("lib/admin/operations-service.ts", "utf8"), /type: data\.purpose === "sign_in_code" && str\(data\.body, 120\) \? str\(data\.body, 120\)/, "Message Status labels the sign-in code row");
  assert.match(fs.readFileSync("app/admin/components/operations-panel.tsx", "utf8"), /const next = withBusinessName\(result\.data, initialData\.businessName\);/, "a background refresh keeps the workspace name");
  console.log("PASS sign-in sends are recorded by message id with a label (never the code); Meta's failure reason is saved and shown; logs carry only ids and statuses");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
