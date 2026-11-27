import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { DashboardAuthorizationError } from "@/lib/admin/dashboard-session";
import { requireProductWhatsAppBusiness } from "@/lib/admin/product-whatsapp-access";
import { stagingAdminWhatsAppUrl } from "@/lib/admin/staging-environment";
import { ProfileEditor } from "@/app/business/_components/whatsapp-profile/profile-editor";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { LoadingPanel } from "@/app/admin/components/shared";
import { EmptyPanel, PageHeader } from "@/app/admin/components/control-center/ui";
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
  if (scope.local) return <div className="space-y-4">{backLink}<PageHeader title="WhatsApp Business Profile" description={scope.business.name} />
    <LocalWhatsAppNotice businessId={businessId} adminHref={stagingAdminWhatsAppUrl(product, businessId, true)} /></div>;
  const profile = await getBusinessProfile(businessId).catch((error: unknown) => {
    if (error instanceof BusinessProfileError) return error;
    throw error;
  });
  if (profile instanceof BusinessProfileError) return <div className="space-y-4">{backLink}<PageHeader title="WhatsApp Business Profile" description={scope.business.name} />
    <EmptyPanel title="Profile unavailable" detail={profile.message} /></div>;
  const managerUrl = profile.wabaId ? `https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${encodeURIComponent(profile.wabaId)}` : "https://business.facebook.com/wa/manage/home/";
  return <div className="space-y-4">{backLink}<ProfileEditor businessId={businessId} product={product} initial={profile} managerUrl={managerUrl} /></div>;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Profile {...props} /></Suspense>;
}
