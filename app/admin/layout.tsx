import { Suspense } from "react";
import { WorkspaceSwitcher } from "./components/workspace-switcher";
import { WorkspaceSwitcherLoading } from "./components/workspace-menu";
import type { Metadata } from "next";
import { AdminShell } from "./components/admin-shell";
import { DashboardAccessRequired } from "./components/dashboard-access-required";
import {
  DashboardAuthorizationError,
  requireDashboardAccess,
} from "@/lib/admin/dashboard-session";
import "./admin.css";
export const metadata: Metadata = {
  title: "Tany Products",
  description: "Tany product workspaces",
};

// Every admin route reads a verified HttpOnly session cookie.
export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireDashboardAccess();
  } catch (error) {
    if (error instanceof DashboardAuthorizationError)
      return <DashboardAccessRequired />;
    throw error;
  }
  return (
    <AdminShell
      workspaceSwitcher={
        <Suspense fallback={<WorkspaceSwitcherLoading />}>
          <WorkspaceSwitcher />
        </Suspense>
      }
    >
      {children}
    </AdminShell>
  );
}
