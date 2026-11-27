import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { formatPhone } from "@/lib/dashboard/business-home";
import { WhatsAppAccountActions } from "@/app/dashboard/messaging/_components/whatsapp-account-actions";
import { connectionStatusView } from "@/lib/whatsapp/connection-status-view";
import { StatusDot, Surface } from "./home/home-primitives";
import { WhatsAppDiagnostics, WhatsAppProfileLink } from "./whatsapp-diagnostics";
import Link from "next/link";
import { workspaceRoot } from "@/lib/admin/workspace-root";
import { getBusinessProfile } from "@/lib/whatsapp/business-profile";
import { isProfileIncomplete } from "@/lib/whatsapp/business-profile-model";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { stagingWorkspaceUrl } from "@/lib/admin/staging-environment";

/** Optional next step after connecting; never blocks the connection. */
async function profileIncomplete(businessId: string) {
  try { return isProfileIncomplete((await getBusinessProfile(businessId)).profile); }
  catch { return false; }
}

const statusCopy = connectionStatusView;

/** Business WhatsApp page. `detailed` is the diagnostics view with account identifiers. */
export async function BusinessWhatsApp({ businessId, detailed = false }: { businessId: string; detailed?: boolean }) {
  const account = await getPostgresBusinessAccount(businessId);
  const status = account?.status ?? "Not connected";
  const copy = statusCopy(status);
  const localStaging = await localStagingWorkspace();
  const suggestProfile = !localStaging && !detailed && status === "Connected" && await profileIncomplete(businessId);
  const details = account ? [
    ["Display name", account.displayName],
    ["Phone number", account.phone ? formatPhone(account.phone) : "—"],
    ["Phone number ID", account.phoneNumberId ?? "—"],
    ["WhatsApp Business Account ID", account.wabaId ?? "—"],
    ["Last updated", account.at ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(account.at)) : "—"],
  ] : [];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">{detailed ? "WhatsApp account" : "WhatsApp"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{detailed ? "Connection details for troubleshooting." : "Your WhatsApp Business number and connection."}</p>
      </div>
      <Surface className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <span className="mt-2"><StatusDot tone={copy.tone} /></span>
          <div className="min-w-0">
            <p className="text-base font-semibold">{copy.title}</p>
            {account?.phone && <p className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">{[account.displayName, formatPhone(account.phone)].filter(Boolean).join(" · ")}</p>}
            <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
          </div>
        </div>
        {copy.showActions && (
          <div className="shrink-0">
            <WhatsAppAccountActions status={status} hasConfiguredPhone={!!account?.phoneNumberId} businessId={businessId}
              stagingHref={localStaging ? `${stagingWorkspaceUrl(businessId)}/whatsapp` : undefined} />
          </div>
        )}
      </Surface>
      {detailed
        ? details.length > 0 && (
          <Surface className="overflow-hidden">
            <dl className="divide-y divide-border/60">
              {details.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </Surface>
        )
        : (
          <>
            {suggestProfile && (
              <div className="flex flex-col gap-3 rounded-xl bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div>
                  <p className="text-sm font-semibold">Complete your WhatsApp profile</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Add a picture, description and contact details so customers recognise your business. Optional.</p>
                </div>
                <Link href={`${await workspaceRoot(businessId)}/whatsapp/profile`} className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Complete profile</Link>
              </div>
            )}
            <WhatsAppProfileLink businessId={businessId} />
            <WhatsAppDiagnostics businessId={businessId} />
          </>
        )}
    </div>
  );
}
