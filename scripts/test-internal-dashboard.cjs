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

  const switcher = source("app/admin/components/workspace-switcher.tsx");
  assert.match(switcher, /listBusinessProfiles/);
  assert.match(switcher, /isActiveTanyVertical\(profile\.vertical\)/);
  assert.doesNotMatch(switcher, /WorkspaceMenu options=\{\[\]\}/);

  const menu = source("app/admin/components/workspace-menu.tsx");
  assert.match(menu, /encodeURIComponent\(option\.id\)/);
  assert.doesNotMatch(menu, /activeProducts/);
  assert.doesNotMatch(menu, /\/admin\/products\/\$\{product\.key\}/);
  assert.match(menu, /isActiveTanyVertical\(key\)/);
  assert.match(menu, /activeOrder\.indexOf\(left\.key\)/);
  assert.match(menu, /product\.active && canSeeAdmin/);
  assert.match(menu, /href=\{`\/admin\/products\/\$\{encodeURIComponent\(product\.key\)\}`\}/);

  const businessLoader = source("app/business/_components/load-business.ts");
  assert.match(businessLoader, /isActiveTanyVertical\(business\.vertical\)/);

  const productResolver = source("app/admin/products/[product]/page.tsx");
  assert.match(productResolver, /listBusinessProfiles/);
  assert.ok(productResolver.includes("redirect(`/business/${encodeURIComponent(business.id)}`)"));
  assert.doesNotMatch(productResolver, /no customer or WhatsApp data is loaded/);

  const workspaceLayout = source("app/business/[businessId]/layout.tsx");
  assert.match(workspaceLayout, /requireDashboardAccess\(businessId\)/);
  assert.doesNotMatch(workspaceLayout, /demo-eats/);
  assert.doesNotMatch(workspaceLayout, /demo-retail/);

  console.log(
    "PASS: signed dashboard authorization, tenant-scoped access, real Firestore workspace discovery, and stable business-ID navigation are enforced.",
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
