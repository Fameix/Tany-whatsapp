import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LoadingPanel } from "./components/shared";
import { SuperAdminSignInRequired } from "./components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { PageHeader } from "./components/control-center/ui";
import { OperationalDashboard } from "./components/control-center/operational-dashboard";
import { isTanyVertical } from "@/lib/messaging/vertical-config";
import { getOperationalOverview } from "@/lib/admin/operational-overview";
import { adminProductPath } from "@/lib/admin/product-routes";

type Props = { searchParams: Promise<{ product?: string | string[] }> };

async function Overview({ searchParams }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product } = await searchParams;
  if (isTanyVertical(product)) redirect(adminProductPath(product));
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 pb-6">
      <PageHeader title="Tany Super Admin" description="Monitor businesses, messaging and operations across Tany." />
      <OperationalDashboard data={await getOperationalOverview(null)} />
    </div>
  );
}

export default function AdminHome(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Overview {...props} /></Suspense>;
}
