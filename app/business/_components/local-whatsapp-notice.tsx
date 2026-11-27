import { stagingWorkspaceUrl } from "@/lib/admin/staging-environment";

export function LocalWhatsAppNotice({ businessId, adminHref }: { businessId: string; adminHref?: string }) {
  return <aside className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
    <div className="min-w-0">
      <p className="font-medium">Local development</p>
      <p className="text-muted-foreground">Use staging for live WhatsApp setup, message sends, webhook validation and profile updates.</p>
    </div>
    <a href={adminHref ?? stagingWorkspaceUrl(businessId)} className="inline-flex min-h-10 items-center rounded-md px-2 font-medium text-primary underline-offset-4 hover:underline">
      {adminHref ? "Open staging WhatsApp" : "Open staging workspace"}
    </a>
  </aside>;
}
