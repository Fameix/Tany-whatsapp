/* eslint-disable @typescript-eslint/no-require-imports */
// Super Admin → Tany Retail is test-retail's business workspace, A to Z: every
// /admin/products/retail/* page is the matching /business/test-retail/* page, and the
// workspace's links stay inside Tany Retail. The WhatsApp page keeps its account states.
const fs = require("node:fs");

async function main() {
  const assert = (await import("node:assert/strict")).default;
  const { connectionStatusView } = await import("../lib/whatsapp/connection-status-view.ts");

  const inactive = connectionStatusView("Inactive");
  assert.deepEqual(inactive, { title: "Business inactive", tone: "neutral", description: "Activate this business to resume messaging and manage WhatsApp.", showActions: false });
  assert.doesNotMatch(inactive.description, /Reconnect/, "an inactive business is never told to reconnect");
  const connected = connectionStatusView("Connected");
  assert.equal(connected.title, "Connected"); assert.equal(connected.tone, "success"); assert.equal(connected.showActions, true);
  const disconnected = connectionStatusView("Disconnected");
  assert.equal(disconnected.title, "Disconnected"); assert.match(disconnected.description, /Reconnect WhatsApp/); assert.equal(disconnected.showActions, true);
  assert.match(connectionStatusView("Not connected").description, /Connect your WhatsApp Business number/);
  assert.equal(connectionStatusView("Configured · unverified").title, "Setup in progress");
  assert.equal(connectionStatusView("Error").showActions, true);
  console.log("PASS each WhatsApp account state shows the right message; only active businesses get actions");

  const { retailWorkspaceTarget, workspaceRootFor } = await import("../lib/admin/retail-workspace.ts");
  const cases = {
    "/admin/products/retail": "/business/test-retail",
    "/admin/products/retail/": "/business/test-retail",
    "/admin/products/retail/inbox": "/business/test-retail/inbox",
    "/admin/products/retail/contacts": "/business/test-retail/contacts",
    "/admin/products/retail/automations": "/business/test-retail/automations",
    "/admin/products/retail/campaigns": "/business/test-retail/campaigns",
    "/admin/products/retail/templates": "/business/test-retail/templates",
    "/admin/products/retail/templates/new": "/business/test-retail/templates/new",
    "/admin/products/retail/products": "/business/test-retail/products",
    "/admin/products/retail/orders": "/business/test-retail/orders",
    "/admin/products/retail/whatsapp": "/business/test-retail/whatsapp",
    "/admin/products/retail/whatsapp/profile": "/business/test-retail/whatsapp/profile",
    "/admin/products/retail/whatsapp/setup": "/business/test-retail/whatsapp/setup",
    "/admin/products/retail/settings": "/business/test-retail/settings",
    "/admin/products/retail/message-status": "/business/test-retail/message-status",
    "/admin/products/retail/stores": null,
    "/admin/products/retailer": null,
    "/admin/products/eats": null,
    "/admin/products/eats/whatsapp": null,
    "/admin/products/motos/inbox": null,
    "/admin": null,
    "/business/test-retail": null,
  };
  for (const [path, target] of Object.entries(cases)) assert.equal(retailWorkspaceTarget(path), target, path);
  assert.equal(workspaceRootFor("test-retail", true), "/admin/products/retail");
  assert.equal(workspaceRootFor("test-retail", false), "/business/test-retail");
  assert.equal(workspaceRootFor("test-eats", true), "/business/test-eats", "only test-retail is aliased");
  console.log("PASS every Tany Retail page maps to test-retail's workspace; Stores stays Super Admin; Eats and Motos unchanged");

  const proxy = fs.readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /requestHeaders\.delete\(workspaceAliasHeader\);/, "a client-supplied alias marker is never trusted");
  assert.match(proxy, /aliasTarget && await verifyDirectorySession\(/, "only a verified Super Admin is rewritten");
  assert.match(proxy, /\|\| request\.headers\.has\(workspaceAliasHeader\)/, "the stripped headers are forwarded whenever a marker was sent");
  const layout = fs.readFileSync("app/business/[businessId]/layout.tsx", "utf8");
  assert.match(layout, /if \(alias && !\(await isSuperAdmin\(\)\)\) return <SuperAdminSignInRequired \/>;/, "the alias layout re-checks Super Admin");
  assert.match(layout, /<WorkspaceRootProvider businessId=\{businessId\} root=\{root\}>/);
  assert.match(fs.readFileSync("app/business/_components/business-access.ts", "utf8"), /if \(\(await isWorkspaceAlias\(\)\) && !\(await isSuperAdmin\(\)\)\) return false;/, "pages re-check Super Admin too");
  const shell = fs.readFileSync("app/admin/components/admin-shell.tsx", "utf8");
  assert.doesNotMatch(shell, /retail-whatsapp-route|workspacePathFor/, "no per-page alias hacks remain");
  for (const file of [
    "app/business/_components/whatsapp-diagnostics.tsx", "app/business/_components/business-whatsapp.tsx",
    "app/business/_components/whatsapp-panel.tsx", "app/business/_components/automation-access-card.tsx",
    "app/business/_components/whatsapp-setup-wizard.tsx", "app/business/[businessId]/templates/page.tsx",
    "app/business/[businessId]/templates/[templateId]/page.tsx", "app/business/[businessId]/whatsapp/profile/page.tsx",
  ]) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /`\/business\/\$\{/, `${file} links inside the current workspace`);
  console.log("PASS alias is Super Admin only and workspace links stay inside Tany Retail");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
