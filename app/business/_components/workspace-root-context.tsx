"use client";

import { createContext, useContext } from "react";
import { businessWorkspacePath } from "@/lib/admin/workspace-path";

const WorkspaceRootContext = createContext<{ businessId: string; root: string } | null>(null);

/** Lets client components link inside the workspace the user is in (see lib/admin/workspace-root). */
export function WorkspaceRootProvider({ businessId, root, children }: { businessId: string; root: string; children: React.ReactNode }) {
  return <WorkspaceRootContext.Provider value={{ businessId, root }}>{children}</WorkspaceRootContext.Provider>;
}

export function useWorkspaceRoot(businessId: string) {
  const value = useContext(WorkspaceRootContext);
  return value?.businessId === businessId ? value.root : businessWorkspacePath(businessId);
}
