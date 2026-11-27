import { Suspense } from "react";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import { AdminProductMenu, AdminProductMenuLoading } from "@/app/admin/components/control-center/product-selector";
import { WorkspaceMenu } from "@/app/admin/components/workspace-menu";
import { AdminShell } from "@/app/admin/components/admin-shell";
import { LoadingPanel } from "@/app/admin/components/shared";
import { loadBusiness } from "@/app/business/_components/load-business";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessSetupRouteHeader, resolveWhatsAppSetupAccess } from "@/lib/admin/whatsapp-setup-access";
import {
  DashboardAuthorizationError,
  requireDashboardAccess,
} from "@/lib/admin/dashboard-session";
import "@/app/admin/admin.css";

export const metadata: Metadata = { title: "Tany WhatsApp Operations" };

function workspaceLog(marker: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") console.info(marker, details);
}

async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ businessId: string }>;
  children: React.ReactNode;
}) {
  await connection();
  const { businessId } = await params;
  let access;
  try {
    access = await requireDashboardAccess(businessId);
  } catch (error) {
    if (error instanceof DashboardAuthorizationError) {
      if ((await headers()).get(businessSetupRouteHeader) === encodeURIComponent(businessId)) {
        const store = await cookies();
        const setupAccess = await resolveWhatsAppSetupAccess(process.env.MESSAGING_SERVICE_SECRET ?? "",
          store.get(dashboardSessionCookieName)?.value ?? "", store.get(whatsappSetupSessionCookieName)?.value ?? "", businessId);
        if (setupAccess.ok && setupAccess.via === "setup-session")
          return <main className="tany-admin p-4 sm:p-6">{children}</main>;
      }
      return <DashboardAccessRequired />;
    }
    throw error;
  }
  workspaceLog("[WORKSPACE_LOAD_START]", { businessId });
  const business = await loadBusiness(businessId);
  workspaceLog("[WORKSPACE_BUSINESS_LOADED]", {
    businessId,
    vertical: business.vertical,
    active: business.active,
  });
  const shellBusiness = { ...business, settings: {}, whatsappPhoneNumberId: "" };
  const { id, name, vertical, active } = shellBusiness;
  const workspaceOptions = active && isActiveTanyVertical(vertical) ? [{ id, name, vertical, active }] : [];
  const localStaging = await localStagingWorkspace();
  workspaceLog("[WORKSPACE_SWITCHER_START]", { businessId });
  workspaceLog("[WORKSPACE_LAYOUT_COMPLETE]", { businessId });
  return (
    <AdminShell
      key={business.id}
      business={shellBusiness}
      workspaceSwitcher={
        access === "admin" ? (
          <Suspense fallback={<AdminProductMenuLoading />}>
            <AdminProductMenu />
          </Suspense>
        ) : (
          <WorkspaceMenu business={shellBusiness} options={workspaceOptions} canSeeAdmin={false} />
        )
      }
    >
      {localStaging && <div className="mb-4"><LocalWhatsAppNotice businessId={businessId} /></div>}
      {children}
    </AdminShell>
  );
}
export default function BusinessLayout(props: {
  params: Promise<{ businessId: string }>;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="tany-admin p-6">
          <LoadingPanel />
        </div>
      }
    >
      <WorkspaceLayout {...props} />
    </Suspense>
  );
}
