import { Suspense } from "react";
import { connection } from "next/server";
import { AdminProductMenu, AdminProductMenuLoading } from "./components/control-center/product-selector";
import type { Metadata } from "next";
import { AdminShell } from "./components/admin-shell";
import { LoadingPanel } from "./components/shared";
import { SuperAdminSignInRequired } from "./components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
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
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
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
