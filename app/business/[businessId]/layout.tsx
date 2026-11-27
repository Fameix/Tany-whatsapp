import { Suspense } from "react";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminProductPath } from "@/lib/admin/product-routes";
import { WorkspaceMenu } from "@/app/admin/components/workspace-menu";
import { AdminShell } from "@/app/admin/components/admin-shell";
import { LoadingPanel } from "@/app/admin/components/shared";
import { workspaceProductContext } from "@/app/business/_components/workspace-product-context";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { WorkspaceRootProvider } from "@/app/business/_components/workspace-root-context";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { isWorkspaceAlias, workspaceDisplayName, workspaceRoot } from "@/lib/admin/workspace-root";
import { AdminProductMenu } from "@/app/admin/components/control-center/product-selector";
import { workspaceProductFor } from "@/lib/admin/product-workspace";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessSetupRouteHeader, resolveWhatsAppSetupAccess } from "@/lib/admin/whatsapp-setup-access";
import {
  DashboardAuthorizationError,
  requireDashboardAccess,
} from "@/lib/admin/dashboard-session";
import "@/app/admin/admin.css";

export async function generateMetadata({ params }: { params: Promise<{ businessId: string }> }): Promise<Metadata> {
  const product = (await isWorkspaceAlias()) ? workspaceProductFor((await params).businessId) : null;
  return { title: product ? `${verticalConfig[product].label} Admin` : "Tany WhatsApp Operations" };
}

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
  // A Super Admin product workspace (e.g. Tany Retail → test-retail) is never served to anyone else.
  const alias = await isWorkspaceAlias();
  if (alias && !(await isSuperAdmin())) return <SuperAdminSignInRequired />;
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
  const { business, product, products } = await workspaceProductContext(businessId);
  if (access === "business" && !product) notFound();
  workspaceLog("[WORKSPACE_BUSINESS_LOADED]", {
    businessId,
    vertical: business.vertical,
    active: business.active,
  });
  const shellBusiness = { ...business, name: await workspaceDisplayName(business), settings: {}, whatsappPhoneNumberId: "" };
  const localStaging = await localStagingWorkspace();
  const root = await workspaceRoot(businessId);
  workspaceLog("[WORKSPACE_SWITCHER_START]", { businessId });
  workspaceLog("[WORKSPACE_LAYOUT_COMPLETE]", { businessId });
  return (
    <AdminShell
      key={business.id}
      business={shellBusiness}
      businessProduct={product}
      workspaceRoot={root}
      workspaceSwitcher={alias ? (
        // Super Admin → <product> is the product's own workspace: the same product selector as
        // every Super Admin page (that product selected), no business switcher, no back link.
        <AdminProductMenu />
      ) : <>
        <WorkspaceMenu business={shellBusiness} product={product} products={products} />
        {access === "admin" && <Link href={adminProductPath(product ?? business.vertical)} className="inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted">Back to product admin</Link>}
      </>}
    >
      <WorkspaceRootProvider businessId={businessId} root={root}>
        {localStaging && <div className="mb-4"><LocalWhatsAppNotice businessId={businessId} /></div>}
        {children}
      </WorkspaceRootProvider>
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
