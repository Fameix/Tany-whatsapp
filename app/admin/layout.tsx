import { Suspense } from "react";
import { connection } from "next/server";
import { AdminProductMenu, AdminProductMenuLoading } from "./components/control-center/product-selector";
import type { Metadata } from "next";
import { AdminShell } from "./components/admin-shell";
import { LoadingPanel } from "./components/shared";
import { DashboardAccessRequired } from "./components/dashboard-access-required";
import {
  DashboardAuthorizationError,
  requireDashboardAccess,
} from "@/lib/admin/dashboard-session";
import "./admin.css";
export const metadata: Metadata = {
  title: "Tany Super Admin",
  description: "Tany product workspaces",
};

// Every admin route reads a verified HttpOnly session cookie.
export const instant = false;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The session check reads the current time, so the layout must render per request.
  await connection();
  try {
    await requireDashboardAccess();
  } catch (error) {
    if (error instanceof DashboardAuthorizationError)
      return <DashboardAccessRequired />;
    throw error;
  }
  return (
    <Suspense fallback={<LoadingPanel />}>
      <AdminShell
        workspaceSwitcher={
          <Suspense fallback={<AdminProductMenuLoading />}>
            <AdminProductMenu />
          </Suspense>
        }
      >
        {children}
      </AdminShell>
    </Suspense>
  );
}
