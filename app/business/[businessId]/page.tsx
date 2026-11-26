import { Suspense } from "react";
import { connection } from "next/server";
import { loadBusiness } from "@/app/business/_components/load-business";
import { BusinessHome } from "@/app/business/_components/home/business-home";
import { LoadingPanel } from "@/app/admin/components/shared";
import { getBusinessHome } from "@/lib/dashboard/business-home";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";

async function Home({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  await connection();
  const { businessId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  const business = await loadBusiness(businessId);
  return <BusinessHome home={await getBusinessHome({ id: business.id, name: business.name, vertical: business.vertical })} />;
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
