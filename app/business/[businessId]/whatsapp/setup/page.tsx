import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { loadBusiness } from "@/app/business/_components/load-business";
import { WhatsAppConnection } from "@/app/dashboard/messaging/_components/whatsapp-connection";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessWhatsAppDashboardPath, resolveWhatsAppSetupAccess } from "@/lib/admin/whatsapp-setup-access";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { embeddedSignupClientConfiguration } from "@/lib/whatsapp/embedded-signup-service";
import { isProductTestBusiness } from "@/lib/admin/product-test-tenants";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { stagingWorkspaceUrl } from "@/lib/admin/staging-environment";

/** Business-scoped Meta Embedded Signup. Business context comes from the route and is
 * authorized only by a matching business session or business setup session. */
async function BusinessWhatsAppSetup({ params }: { params: Promise<{ businessId: string }> }) {
  await connection();
  const { businessId } = await params;
  const dashboardHref = businessWhatsAppDashboardPath(businessId);
  const local = await localStagingWorkspace();
  if (local) {
    if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  } else {
    const store = await cookies();
    const access = await resolveWhatsAppSetupAccess(
      process.env.MESSAGING_SERVICE_SECRET ?? "",
      store.get(dashboardSessionCookieName)?.value ?? "",
      store.get(whatsappSetupSessionCookieName)?.value ?? "",
      businessId,
    );
    if (!access.ok && access.reason === "admin-requires-handoff") redirect(dashboardHref);
    if (!access.ok) return <DashboardAccessRequired />;
  }
  await loadBusiness(businessId);
  const clientConnection = await getClientWhatsAppConnection(businessId);
  if (!local && clientConnection.status === "connected" && clientConnection.health === "verified") redirect(dashboardHref);
  return (
    <div className="flex justify-center py-6 sm:py-10">
      <WhatsAppConnection initialConnection={clientConnection} embeddedSignup={local ? null : embeddedSignupClientConfiguration()}
        stagingHref={local ? `${stagingWorkspaceUrl(businessId)}/whatsapp/setup` : undefined}
        dashboardHref={dashboardHref} businessId={businessId} connectLabel={isProductTestBusiness(businessId) ? "Connect WhatsApp" : undefined} />
    </div>
  );
}

export default function Page(props: { params: Promise<{ businessId: string }> }) {
  return <Suspense fallback={<LoadingPanel />}><BusinessWhatsAppSetup {...props} /></Suspense>;
}
