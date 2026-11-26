/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = (path) => fs.readFileSync(path, "utf8");
const businessRoute = source("app/business/[businessId]/[section]/page.tsx");
const operationsPage = source("app/admin/components/operations-page.tsx");
const directoryPage = source("app/admin/components/postgres-directory-overview.tsx");
const actions = source("app/dashboard/messaging/_components/whatsapp-account-actions.tsx");

assert.match(businessRoute, /clientFacing=\{section === "whatsapp-accounts"\}/);
assert.match(operationsPage, /showConnectionCta=\{clientFacing && section === "whatsapp-accounts"\}/);
assert.match(operationsPage, /clientFacing = false/);
assert.match(directoryPage, /showConnectionCta && business && <WhatsAppAccountActions/);
assert.match(directoryPage, /businessId=\{business\.id\}/);
assert.match(actions, /api\/businesses\/\$\{encodeURIComponent\(businessId\)\}\/whatsapp\/setup\/handoff/);
assert.match(actions, /status\.includes\("unverified"\) \? "Continue setup"/);
assert.match(actions, /status === "Error" \|\| status === "Disconnected" \? "Reconnect WhatsApp"/);
assert.match(actions, /: "Connect WhatsApp"/);
assert.match(actions, /const connected = status === "Connected"/);
assert.match(actions, /!connected && <Button className=/);

console.log("PASS business WhatsApp Accounts route renders Connect WhatsApp for Not connected; Super Admin default remains off.");
