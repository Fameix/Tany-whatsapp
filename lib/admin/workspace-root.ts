import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { workspaceAliasHeader, workspaceRootFor } from "./retail-workspace";

/** True when this request is a Super Admin alias of a business workspace (see retail-workspace). */
export const isWorkspaceAlias = cache(async () => (await headers()).get(workspaceAliasHeader) === "1");

/** The root a business workspace page links under for this request. */
export async function workspaceRoot(businessId: string) {
  return workspaceRootFor(businessId, await isWorkspaceAlias());
}
