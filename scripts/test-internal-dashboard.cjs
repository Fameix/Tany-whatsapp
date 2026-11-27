/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
function source(path) {
  return fs.readFileSync(path, "utf8");
}

function main() {
  const session = source("lib/admin/dashboard-session.ts");
  assert.match(session, /resolveDashboardSession/);
  assert.match(session, /dashboardSessionCookieName/);
  assert.doesNotMatch(session, /return \{ role: "admin" \}/);

  const operationsApi = source("app/api/admin/operations/route.ts");
  assert.match(operationsApi, /getDashboardSession/);
  assert.match(operationsApi, /requireDashboardAccess/);
  assert.doesNotMatch(
    operationsApi,
    /const principal = \{ role: "admin" as const \}/,
  );

  const switcher = source("app/business/[businessId]/layout.tsx");
  assert.match(switcher, /requireDashboardAccess\(businessId\)/);
  assert.match(switcher, /hasWorkspaceEntitlement\(businessId\)/);
  assert.doesNotMatch(switcher, /WorkspaceMenu|AdminProductMenu|businessProduct|listBusinessProfiles/);
  const adminLayout = source("app/admin/layout.tsx");
  assert.match(adminLayout, /<AdminProductMenu\s*\/>/);
  assert.doesNotMatch(adminLayout, /<WorkspaceSwitcher\s*\/>/);
  const productSelector = source("app/admin/components/control-center/product-selector.tsx");
  assert.match(productSelector, /tanyProducts\.map/);
  assert.match(productSelector, /router\.push\(adminProductPath\(id\)\)/);
  assert.match(productSelector, /adminProductFromPath\(usePathname\(\)\)/);
  assert.match(productSelector, /Search products/);
  assert.doesNotMatch(productSelector, /listBusinessProfiles|WorkspaceOption|\/business\//);

  const shell = source("app/admin/components/admin-shell.tsx");
  const clientNav = shell.slice(shell.indexOf("function businessNavigation"), shell.indexOf("const businessPageLabels"));
  assert.deepEqual([...clientNav.matchAll(/label: "([^"]+)"/g)].map(match => match[1]),
    ["Home", "Inbox", "Customers", "Automations", "Campaigns", "Templates", "WhatsApp", "Settings"]);
  assert.doesNotMatch(shell, /Product tools|businessProduct/);

  const businessLoader = source("app/business/_components/load-business.ts");
  assert.match(businessLoader, /isActiveTanyVertical\(business\.vertical\)/);

  const productResolver = source("app/admin/products/[product]/page.tsx");
  assert.match(productResolver, /isSuperAdmin\(\)/);
  assert.match(productResolver, /liveProduct \? await getOperationalOverview\(liveProduct, \{ includeTestData \}\) : null/);
  assert.match(productResolver, /<BusinessTable businesses=\{data\.directory\}/);
  const businessTable = source("app/admin/components/control-center/ui.tsx");
  assert.match(businessTable, /businessWorkspacePath\(business\.id\)/);
  const productSection = source("app/admin/products/[product]/[section]/page.tsx");
  assert.match(productSection, /productNavigation\(product\)/);
  assert.match(productSection, /getProductOperationsData\(live, includeTestData\)/);
  assert.match(productSection, /productWorkspaceRedirect/);
  assert.doesNotMatch(productSection, /AutomationBuilder|listProductRecords|section === "inbox"/);
  assert.doesNotMatch(productSection, /getOperationsData\(|listBusinessProfiles/);
  assert.match(source("lib/admin/operations-service.ts"), /aggregateOperations\(await listProductProfiles\(product, includeTestData\)/);
  assert.match(source("app/admin/product-test-data-actions.ts"), /await isSuperAdmin\(\)/);

  assert.match(adminLayout, /isSuperAdmin\(\)/);
  assert.match(adminLayout, /SuperAdminSignInRequired/);
  assert.doesNotMatch(adminLayout, /DashboardAccessRequired|requireDashboardAccess/);

  const workspaceLayout = source("app/business/[businessId]/layout.tsx");
  assert.match(workspaceLayout, /requireDashboardAccess\(businessId\)/);
  assert.doesNotMatch(workspaceLayout, /demo-eats/);
  assert.doesNotMatch(workspaceLayout, /demo-retail/);
  assert.doesNotMatch(source("app/business/[businessId]/not-found.tsx"), /Super Admin|\/admin/);

  console.log(
    "PASS: signed dashboard authorization, product-scoped discovery, tenant-scoped access, and stable business-ID navigation are enforced.",
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
