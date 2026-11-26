import { Suspense } from "react";
import { connection } from "next/server";
import { OperationsPage } from "./components/operations-page";
import { LoadingPanel } from "./components/shared";
import { DashboardAccessRequired } from "./components/dashboard-access-required";
import {
  DashboardAuthorizationError,
  requireDashboardAccess,
} from "@/lib/admin/dashboard-session";

async function Overview() {
  await connection();
  try {
    await requireDashboardAccess();
  } catch (error) {
    if (error instanceof DashboardAuthorizationError)
      return <DashboardAccessRequired />;
    throw error;
  }
  return <OperationsPage />;
}

export default function AdminHome() {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Overview />
    </Suspense>
  );
}
