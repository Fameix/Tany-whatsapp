import { Suspense } from "react";
import { connection } from "next/server";
import { OperationsPage } from "@/app/admin/components/operations-page";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { canViewBusiness } from "@/app/business/_components/business-access";
async function Accounts({ params }: { params: Promise<{ businessId: string }> }) {
  await connection();
  const { businessId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  return <OperationsPage businessId={businessId} section="whatsapp-accounts" clientFacing />;
}
export default function Page(props: { params: Promise<{ businessId: string }> }) {
  return <Suspense fallback={<LoadingPanel />}><Accounts {...props} /></Suspense>;
}
