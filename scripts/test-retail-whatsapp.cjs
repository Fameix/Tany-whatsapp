/* eslint-disable @typescript-eslint/no-require-imports */
// Retail WhatsApp: the business's own WhatsApp page (also shown in Super Admin → Tany Retail)
// gives each account state the right message and only offers Connect/Disconnect when active.
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
  const notConnected = connectionStatusView("Not connected");
  assert.match(notConnected.description, /Connect your WhatsApp Business number/); assert.equal(notConnected.showActions, true);
  const setup = connectionStatusView("Configured · unverified");
  assert.equal(setup.title, "Setup in progress"); assert.equal(setup.showActions, true);
  assert.equal(connectionStatusView("Error").showActions, true);
  console.log("PASS inactive, connected, disconnected, not connected and setup states each show the right message; only active businesses get actions");

  const page = fs.readFileSync("app/business/_components/business-whatsapp.tsx", "utf8");
  assert.match(page, /const statusCopy = connectionStatusView;/, "the business page uses the shared state view");
  assert.match(page, /\{copy\.showActions && \(\s*<div className="shrink-0">\s*<WhatsAppAccountActions/, "actions are hidden for an inactive business");
  const retail = fs.readFileSync("app/admin/components/control-center/retail-whatsapp.tsx", "utf8");
  assert.match(retail, /import BusinessLayout from "@\/app\/business\/\[businessId\]\/layout";/, "uses the real business layout (sidebar, header, access checks)");
  assert.match(retail, /import BusinessWhatsAppPage from "@\/app\/business\/\[businessId\]\/whatsapp\/page";/, "uses the real business WhatsApp page");
  assert.match(retail, /<BusinessLayout params=\{params\}>\s*<BusinessWhatsAppPage params=\{params\} \/>\s*<\/BusinessLayout>/);
  assert.doesNotMatch(retail, /WhatsAppBusinessSelector|ProductWhatsApp|listProductProfiles|includeTestData/, "no selector, no product view, not tied to the test-data toggle");
  const route = fs.readFileSync("lib/admin/retail-whatsapp-route.ts", "utf8");
  assert.match(route, /retailWhatsAppBusinessId = "test-retail"/, "hard-bound to test-retail");
  const shell = fs.readFileSync("app/admin/components/admin-shell.tsx", "utf8");
  assert.match(shell, /if \(!business && rawPathname === retailWhatsAppAdminPath\) return <>\{children\}<\/>;/, "Super Admin chrome steps aside on that path");
  assert.equal((shell.match(/workspacePathFor\(usePathname\(\)\)/g) ?? []).length, 2, "business sidebar and breadcrumb treat the alias as test-retail's WhatsApp page");
  assert.match(fs.readFileSync("app/admin/layout.tsx", "utf8"), /if \(!\(await isSuperAdmin\(\)\)\) return <SuperAdminSignInRequired \/>;/, "Super Admin sign-in still required");
  const section = fs.readFileSync("app/admin/products/[product]/[section]/page.tsx", "utf8");
  assert.match(section, /section === "whatsapp" && live === "retail"\) return <RetailWhatsApp \/>;/);
  assert.ok(section.indexOf("isSuperAdmin()") > 0 && section.indexOf("isSuperAdmin()") < section.indexOf("<RetailWhatsApp />"), "Super Admin is checked first");
  assert.match(section, /if \(section === "whatsapp"\) return <ProductWhatsApp/, "Eats and Motos keep the product WhatsApp page");
  console.log("PASS direct business view and Super Admin Retail view share one page; Eats and Motos unchanged");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
