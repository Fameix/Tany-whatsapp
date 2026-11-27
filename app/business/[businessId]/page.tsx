import { Suspense } from "react";
import { connection } from "next/server";
import { workspaceProductContext } from "@/app/business/_components/workspace-product-context";
import { BusinessHome } from "@/app/business/_components/home/business-home";
import { LoadingPanel } from "@/app/admin/components/shared";
import { getBusinessHome } from "@/lib/dashboard/business-home";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { workspaceDisplayName, workspaceRoot } from "@/lib/admin/workspace-root";

async function Home({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  await connection();
  const { businessId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  const { business, product } = await workspaceProductContext(businessId);
  return <BusinessHome home={await getBusinessHome({ id: business.id, name: await workspaceDisplayName(business), vertical: product ?? business.vertical }, await workspaceRoot(business.id))} />;
}
export default function BusinessOverview(props: {
  params: Promise<{ businessId: string }>;
}) {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <Home {...props} />
    </Suspense>
  );
}
