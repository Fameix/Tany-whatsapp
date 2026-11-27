/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = (path) => fs.readFileSync(path, "utf8");
const businessRoute = source("app/business/[businessId]/[section]/page.tsx");
const operationsPage = source("app/admin/components/operations-page.tsx");
const directoryPage = source("app/admin/components/postgres-directory-overview.tsx");
const actions = source("app/dashboard/messaging/_components/whatsapp-account-actions.tsx");
const whatsappPage = source("app/business/[businessId]/whatsapp/page.tsx");
const businessWhatsApp = source("app/business/_components/business-whatsapp.tsx");

// Business WhatsApp pages are scoped to the one business and keep the existing connect/disconnect actions.
assert.match(whatsappPage, /section="whatsapp-accounts" clientFacing/);
assert.match(businessRoute, /clientFacing=\{false\}/, "the /whatsapp-accounts route is the diagnostics view");
assert.match(operationsPage, /postgresDirectory && businessId && section === "whatsapp-accounts"\)\s*return <BusinessWhatsApp businessId=\{businessId\} detailed=\{!clientFacing\} \/>/);
assert.match(businessWhatsApp, /getPostgresBusinessAccount\(businessId\)/, "reads only this business's account");
assert.doesNotMatch(businessWhatsApp, /getPostgresDirectoryOverview/, "never reads the cross-tenant directory");
assert.match(businessWhatsApp, /const status = account\?\.status \?\? "Not connected"/);
assert.match(businessWhatsApp, /<WhatsAppAccountActions status=\{status\} hasConfiguredPhone=\{!!account\?\.phoneNumberId\} businessId=\{businessId\}[\s\S]*?stagingHref=/);
// The Super Admin directory still renders the CTA only when explicitly requested.
assert.match(operationsPage, /showConnectionCta=\{clientFacing && section === "whatsapp-accounts"\}/);
assert.match(operationsPage, /clientFacing = false/);
assert.match(directoryPage, /showConnectionCta && business && <WhatsAppAccountActions/);
assert.match(directoryPage, /businessId=\{business\.id\}/);
assert.match(actions, /api\/businesses\/\$\{encodeURIComponent\(businessId\)\}\/whatsapp\/setup\/handoff/);
assert.match(actions, /status\.includes\("unverified"\) \? "Continue setup"/);
assert.match(actions, /status === "Error" \|\| status === "Disconnected" \? "Reconnect WhatsApp"/);
assert.match(actions, /: "Connect WhatsApp"/);
assert.match(actions, /const connected = status === "Connected"/);
assert.match(actions, /!connected && \(stagingHref[\s\S]*?: <Button className=/);

console.log("PASS business WhatsApp Accounts route renders Connect WhatsApp for Not connected; Super Admin default remains off.");
