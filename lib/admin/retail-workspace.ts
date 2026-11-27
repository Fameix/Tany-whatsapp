import { businessWorkspacePath } from "./workspace-path";

/** Super Admin → Tany Retail is test-retail's business workspace, A to Z: every
 * /admin/products/retail/* URL shows the matching /business/test-retail/* page, and the
 * workspace's own links stay under /admin/products/retail. */
export const retailWorkspaceBusinessId = "test-retail";
export const retailWorkspaceAdminRoot = "/admin/products/retail";
/** Set by the proxy, only for a verified Super Admin, on a rewritten alias request. */
export const workspaceAliasHeader = "x-tany-workspace-alias";
/** The old Tany Retail product dashboard's pages; they now open the workspace instead. */
const retiredSections = new Set(["stores", "staging"]);

/** The business workspace path an alias URL stands for, or null when it is not an alias. */
export function retailWorkspaceTarget(pathname: string) {
  if (pathname !== retailWorkspaceAdminRoot && !pathname.startsWith(retailWorkspaceAdminRoot + "/")) return null;
  const rest = pathname.slice(retailWorkspaceAdminRoot.length).replace(/\/$/, "");
  if (retiredSections.has(rest.split("/")[1])) return null;
  return businessWorkspacePath(retailWorkspaceBusinessId) + rest;
}

/** Where an old Tany Retail dashboard URL now goes (the workspace Home), or null. */
export function retiredRetailRedirect(pathname: string) {
  const match = /^\/admin\/products\/retail\/([^/]+)/.exec(pathname);
  return match && retiredSections.has(match[1]) ? retailWorkspaceAdminRoot : null;
}

/** Where a business's workspace links point: the alias root inside Tany Retail, else /business/<id>. */
export function workspaceRootFor(businessId: string, aliased: boolean) {
  return aliased && businessId === retailWorkspaceBusinessId ? retailWorkspaceAdminRoot : businessWorkspacePath(businessId);
}
