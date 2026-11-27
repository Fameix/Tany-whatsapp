import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { loadBusiness } from "@/app/business/_components/load-business";
import { LoadingPanel } from "@/app/admin/components/shared";
async function LegacyCatalog({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { businessId } = await params;
  await loadBusiness(businessId);
  return redirect(`/business/${encodeURIComponent(businessId)}/catalog`);
}
export default function LegacyCatalogPage(props: {
  params: Promise<{ businessId: string }>;
}) {
  return (
    <Suspense fallback={<LoadingPanel />}>
      <LegacyCatalog {...props} />
    </Suspense>
  );
}
