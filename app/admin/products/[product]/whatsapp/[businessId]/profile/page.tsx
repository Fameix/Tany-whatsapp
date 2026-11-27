import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { DashboardAuthorizationError } from "@/lib/admin/dashboard-session";
import { requireProductWhatsAppBusiness } from "@/lib/admin/product-whatsapp-access";
import { stagingAdminWhatsAppUrl } from "@/lib/admin/staging-environment";
import { Button } from "@/components/ui/button";
import { businessWorkspacePath } from "@/lib/admin/workspace-path";
import { isProfileIncomplete } from "@/lib/whatsapp/business-profile-model";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { LoadingPanel } from "@/app/admin/components/shared";
import { EmptyPanel, PageHeader, surface } from "@/app/admin/components/control-center/ui";
import { BusinessProfileError, getBusinessProfile } from "@/lib/whatsapp/business-profile";

type Props = { params: Promise<{ product: string; businessId: string }> };

async function Profile({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const { product, businessId } = await params;
  const scope = await requireProductWhatsAppBusiness(product, businessId).catch((error: unknown) => {
    if (error instanceof DashboardAuthorizationError) notFound();
    throw error;
  });
  const back = `/admin/products/${encodeURIComponent(product)}/whatsapp?business=${encodeURIComponent(businessId)}`;
  const backLink = <Link href={back} className="text-sm font-medium text-primary hover:underline">Back to WhatsApp</Link>;
  const workspace = businessWorkspacePath(businessId) + "/whatsapp/profile";
  const openWorkspace = <Button asChild><Link href={workspace}>Open workspace profile</Link></Button>;
  if (scope.local) return <div className="space-y-4">{backLink}<PageHeader title="WhatsApp Business Profile" description={scope.business.name} />
    <LocalWhatsAppNotice businessId={businessId} adminHref={stagingAdminWhatsAppUrl(product, businessId, true)} />{openWorkspace}</div>;
  const profile = await getBusinessProfile(businessId).catch((error: unknown) => {
    if (error instanceof BusinessProfileError) return error;
    throw error;
  });
  if (profile instanceof BusinessProfileError) return <div className="space-y-4">{backLink}<PageHeader title="WhatsApp Business Profile" description={scope.business.name} />
    <EmptyPanel title="Profile unavailable" detail={profile.message} action={openWorkspace} /></div>;
  return <div className="space-y-4">
    {backLink}
    <PageHeader title="WhatsApp Business Profile" description={scope.business.name} action={openWorkspace} />
    <section aria-label="Profile status" className={surface + " p-4"}>
      <h2 className="font-semibold">Profile status</h2>
      <p className="mt-1 text-sm text-muted-foreground">{isProfileIncomplete(profile.profile) ? "Profile incomplete" : "Profile complete"}</p>
    </section>
  </div>;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Profile {...props} /></Suspense>;
}
