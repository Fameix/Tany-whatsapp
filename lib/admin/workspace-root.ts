import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import type { TanyVertical } from "@/lib/messaging/types";
import { workspaceAliasHeader, workspaceRootFor } from "./retail-workspace";

/** True when this request is a Super Admin alias of a business workspace (see retail-workspace). */
export const isWorkspaceAlias = cache(async () => (await headers()).get(workspaceAliasHeader) === "1");

/** The root a business workspace page links under for this request. */
export async function workspaceRoot(businessId: string) {
  return workspaceRootFor(businessId, await isWorkspaceAlias());
}

/** The name the workspace shows. Inside Super Admin the alias is the product's own workspace
 * (Tany Retail), backed by its staging business, so it shows the product name. */
export async function workspaceDisplayName(business: { name: string; vertical: TanyVertical }) {
  return (await isWorkspaceAlias()) ? verticalConfig[business.vertical].label : business.name;
}
