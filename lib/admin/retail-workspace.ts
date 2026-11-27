import { businessWorkspacePath } from "./workspace-path";

/** Super Admin → Tany Retail is test-retail's business workspace, A to Z: every
 * /admin/products/retail/* URL shows the matching /business/test-retail/* page, and the
 * workspace's own links stay under /admin/products/retail. */
export const retailWorkspaceBusinessId = "test-retail";
export const retailWorkspaceAdminRoot = "/admin/products/retail";
/** Set by the proxy, only for a verified Super Admin, on a rewritten alias request. */
export const workspaceAliasHeader = "x-tany-workspace-alias";
/** Tany Retail pages that stay Super Admin pages instead of workspace pages. */
const adminSections = new Set(["stores"]);

/** The business workspace path an alias URL stands for, or null when it is not an alias. */
export function retailWorkspaceTarget(pathname: string) {
  if (pathname !== retailWorkspaceAdminRoot && !pathname.startsWith(retailWorkspaceAdminRoot + "/")) return null;
  const rest = pathname.slice(retailWorkspaceAdminRoot.length).replace(/\/$/, "");
  if (adminSections.has(rest.split("/")[1])) return null;
  return businessWorkspacePath(retailWorkspaceBusinessId) + rest;
}

/** Where a business's workspace links point: the alias root inside Tany Retail, else /business/<id>. */
export function workspaceRootFor(businessId: string, aliased: boolean) {
  return aliased && businessId === retailWorkspaceBusinessId ? retailWorkspaceAdminRoot : businessWorkspacePath(businessId);
}
