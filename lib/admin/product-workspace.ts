import { businessWorkspacePath } from "./workspace-path";
import { productTestTenants, type ProductTestProduct } from "./product-test-tenants";

/** Super Admin → a live product is that product's workspace, A to Z: every
 * /admin/products/<product>/* URL shows the matching /business/<test tenant>/* page, and the
 * workspace's own links stay under /admin/products/<product>. Retail is the reference; Motos
 * and Eats follow it. Products without a test tenant (coming soon) keep their admin page. */
export const productWorkspaceRoot = (product: ProductTestProduct) => `/admin/products/${product}`;
/** Set by the proxy, only for a verified Super Admin, on a rewritten alias request. */
export const workspaceAliasHeader = "x-tany-workspace-alias";
/** The old product dashboards' pages; they now open the workspace instead. */
const retiredSections = new Set(["stores", "restaurants", "dealers", "staging"]);
const products = Object.keys(productTestTenants) as ProductTestProduct[];

function aliasParts(pathname: string) {
  const match = /^\/admin\/products\/([^/]+)(\/.*)?$/.exec(pathname);
  const product = products.find(id => id === match?.[1]);
  return product ? { product, rest: (match![2] ?? "").replace(/\/$/, "") } : null;
}

/** The business workspace path an alias URL stands for, or null when it is not an alias. */
export function productWorkspaceTarget(pathname: string) {
  const parts = aliasParts(pathname);
  if (!parts || retiredSections.has(parts.rest.split("/")[1])) return null;
  return businessWorkspacePath(productTestTenants[parts.product].businessId) + parts.rest;
}

/** Where an old product dashboard URL now goes (the workspace Home), or null. */
export function retiredProductRedirect(pathname: string) {
  const parts = aliasParts(pathname);
  return parts && retiredSections.has(parts.rest.split("/")[1]) ? productWorkspaceRoot(parts.product) : null;
}

/** The product whose Super Admin workspace a business backs, if any. */
export const workspaceProductFor = (businessId: string) => products.find(id => productTestTenants[id].businessId === businessId) ?? null;

/** Where a business's workspace links point: its product root inside Super Admin, else /business/<id>. */
export function workspaceRootFor(businessId: string, aliased: boolean) {
  const product = aliased ? workspaceProductFor(businessId) : null;
  return product ? productWorkspaceRoot(product) : businessWorkspacePath(businessId);
}
