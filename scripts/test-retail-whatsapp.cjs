/* eslint-disable @typescript-eslint/no-require-imports */
// Super Admin → each live product (Retail, Eats, Motos) is its test tenant's business workspace,
// A to Z: every /admin/products/<product>/* page is the matching /business/<tenant>/* page, and
// the workspace's links stay inside that product. The WhatsApp page keeps its account states.
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

  const { productWorkspaceTarget, retiredProductRedirect, workspaceRootFor, workspaceProductFor } = await import("../lib/admin/product-workspace.ts");
  const tenants = { retail: "test-retail", eats: "test-eats", motos: "test-motos" };
  const shared = ["", "/inbox", "/contacts", "/automations", "/campaigns", "/templates", "/templates/new", "/whatsapp", "/whatsapp/profile", "/whatsapp/setup", "/whatsapp-accounts", "/message-status", "/webhook-health", "/settings"];
  const tools = { retail: ["/products", "/orders"], eats: ["/menu", "/orders", "/delivery"], motos: ["/vehicles", "/leads", "/test-drives"] };
  for (const [product, tenant] of Object.entries(tenants)) {
    for (const rest of [...shared, ...tools[product]])
      assert.equal(productWorkspaceTarget(`/admin/products/${product}${rest}`), `/business/${tenant}${rest}`, `${product}${rest}`);
    assert.equal(productWorkspaceTarget(`/admin/products/${product}/`), `/business/${tenant}`);
    assert.equal(workspaceRootFor(tenant, true), `/admin/products/${product}`);
    assert.equal(workspaceRootFor(tenant, false), `/business/${tenant}`);
    assert.equal(workspaceProductFor(tenant), product);
  }
  for (const [product, old] of [["retail", "stores"], ["eats", "restaurants"], ["motos", "dealers"], ["retail", "staging"], ["eats", "staging"], ["motos", "staging"]]) {
    assert.equal(productWorkspaceTarget(`/admin/products/${product}/${old}`), null);
    assert.equal(retiredProductRedirect(`/admin/products/${product}/${old}`), `/admin/products/${product}`, `${product}/${old} opens the workspace, not the old directory`);
  }
  for (const path of ["/admin/products/cabs", "/admin/products/salon/settings", "/admin/products/retailer", "/admin", "/admin/products", "/business/test-retail", "/admin/businesses"]) {
    assert.equal(productWorkspaceTarget(path), null, path);
    assert.equal(retiredProductRedirect(path), null, path);
  }
  assert.equal(workspaceRootFor("some-real-business", true), "/business/some-real-business", "only test tenants back a product workspace");
  for (const file of ["app/admin/products/[product]/page.tsx", "app/admin/products/[product]/[section]/page.tsx"]) {
    const page = fs.readFileSync(file, "utf8");
    assert.match(page, /if \(!product \|\| isActiveTanyVertical\(product\.id\)\) notFound\(\);/, `${file}: no old live-product dashboard is rendered`);
    assert.doesNotMatch(page, /BusinessTable|Open workspace|getOperationalOverview|ProductWhatsApp/, `${file}: no directory-first UX`);
  }
  assert.match(fs.readFileSync("proxy.ts", "utf8"), /if \(retired\) \{/, "the proxy redirects old product URLs");
  const context = fs.readFileSync("app/business/_components/workspace-product-context.ts", "utf8");
  assert.match(context, /const aliasProduct = \(await isWorkspaceAlias\(\)\) \? workspaceProductFor\(businessId\) : null;/, "a Super Admin product workspace shows that product's tools");
  const home = fs.readFileSync("lib/dashboard/business-home.ts", "utf8");
  assert.match(home, /error instanceof SetupError && error\.code === "BUSINESS_UNAVAILABLE"\) return null;/, "Home shows an inactive business instead of failing");
  console.log("PASS Retail, Eats and Motos each map every page to their own test tenant; old dashboard URLs open the workspace; coming-soon products untouched");

  const proxy = fs.readFileSync("proxy.ts", "utf8");
  assert.match(proxy, /requestHeaders\.delete\(workspaceAliasHeader\);/, "a client-supplied alias marker is never trusted");
  assert.match(proxy, /aliasTarget && await verifyDirectorySession\(/, "only a verified Super Admin is rewritten");
  assert.match(proxy, /\|\| request\.headers\.has\(workspaceAliasHeader\)/, "the stripped headers are forwarded whenever a marker was sent");
  const layout = fs.readFileSync("app/business/[businessId]/layout.tsx", "utf8");
  assert.match(layout, /if \(alias && !\(await isSuperAdmin\(\)\)\) return <SuperAdminSignInRequired \/>;/, "the alias layout re-checks Super Admin");
  assert.match(layout, /<WorkspaceRootProvider businessId=\{businessId\} root=\{root\}>/);
  assert.doesNotMatch(layout, /Back to Super Admin/, "Tany Retail is the product's own workspace: no back link");
  assert.match(layout, /<AdminProductMenu \/>/, "Tany Retail has the same product selector as Motos and Eats");
  assert.match(layout, /name: await workspaceDisplayName\(business\)/, "the shell shows the product name, not the staging business");
  assert.match(fs.readFileSync("lib/admin/workspace-root.ts", "utf8"), /\(await isWorkspaceAlias\(\)\) \? verticalConfig\[business\.vertical\]\.label : business\.name/);
  assert.doesNotMatch(fs.readFileSync("app/business/_components/product-admin-links.tsx", "utf8"), /href: "\/admin"/, "Settings has no back-to-Super-Admin row");
  assert.match(fs.readFileSync("app/business/_components/business-access.ts", "utf8"), /if \(\(await isWorkspaceAlias\(\)\) && !\(await isSuperAdmin\(\)\)\) return false;/, "pages re-check Super Admin too");
  const shell = fs.readFileSync("app/admin/components/admin-shell.tsx", "utf8");
  assert.doesNotMatch(shell, /retail-whatsapp-route|workspacePathFor/, "no per-page alias hacks remain");
  for (const file of [
    "app/business/_components/whatsapp-diagnostics.tsx", "app/business/_components/business-whatsapp.tsx",
    "app/business/_components/whatsapp-panel.tsx", "app/business/_components/automation-access-card.tsx",
    "app/business/_components/whatsapp-setup-wizard.tsx", "app/business/[businessId]/templates/page.tsx",
    "app/business/[businessId]/templates/[templateId]/page.tsx", "app/business/[businessId]/whatsapp/profile/page.tsx",
  ]) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /`\/business\/\$\{/, `${file} links inside the current workspace`);
  console.log("PASS alias is Super Admin only and workspace links stay inside the product");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
