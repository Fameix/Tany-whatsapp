import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { loadBusiness } from "@/app/business/_components/load-business";
import { ProfileEditor } from "@/app/business/_components/whatsapp-profile/profile-editor";
import { BusinessProfileError, getBusinessProfile } from "@/lib/whatsapp/business-profile";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { stagingWorkspaceUrl } from "@/lib/admin/staging-environment";
import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { workspaceRoot } from "@/lib/admin/workspace-root";

type Props = { params: Promise<{ businessId: string }> };

function Unavailable({ title, detail, action }: { title: string; detail: string; action?: { label: string; href: string } }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Business Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage how your business appears to customers on WhatsApp.</p>
      </div>
      <div className="flex flex-col items-center gap-2 rounded-xl bg-card px-6 py-12 text-center shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]">
        <p className="text-sm font-semibold">{title}</p>
        <p className="max-w-sm text-xs leading-5 text-muted-foreground">{detail}</p>
        {action && <Link href={action.href} className="mt-2 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{action.label}</Link>}
      </div>
    </div>
  );
}

async function Profile({ params }: Props) {
  await connection();
  const { businessId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  await loadBusiness(businessId);
  if (await localStagingWorkspace()) {
    const account = await getPostgresBusinessAccount(businessId);
    return <ProfileEditor businessId={businessId} initial={null} storedAccount={account ?? undefined}
      stagingHref={`${stagingWorkspaceUrl(businessId)}/whatsapp/profile`} />;
  }
  const whatsapp = `${await workspaceRoot(businessId)}/whatsapp`;
  const result = await getBusinessProfile(businessId).catch((error: unknown) => {
    if (error instanceof BusinessProfileError) return error;
    throw error;
  });
  if (result instanceof BusinessProfileError) {
    if (result.code === "NOT_CONNECTED") return <Unavailable title="WhatsApp isn't connected" detail="Connect your WhatsApp Business number to manage how your business appears to customers." action={{ label: "Connect WhatsApp", href: whatsapp }} />;
    if (result.code === "CREDENTIAL" || result.code === "PERMISSION") return <Unavailable title="Reconnect WhatsApp" detail={result.message} action={{ label: "Go to WhatsApp", href: whatsapp }} />;
    return <Unavailable title="Your profile couldn't be loaded" detail={result.message} />;
  }
  const managerUrl = result.wabaId ? `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(result.wabaId)}` : "https://business.facebook.com/wa/manage/home/";
  return <ProfileEditor businessId={businessId} initial={result} managerUrl={managerUrl} />;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Profile {...props} /></Suspense>;
}
