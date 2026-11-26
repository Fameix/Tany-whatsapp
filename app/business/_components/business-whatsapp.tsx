import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { formatPhone } from "@/lib/dashboard/business-home";
import { WhatsAppAccountActions } from "@/app/dashboard/messaging/_components/whatsapp-account-actions";
import { StatusDot, Surface } from "./home/home-primitives";
import { WhatsAppDiagnostics } from "./whatsapp-diagnostics";

const statusCopy = (status: string) =>
  status === "Connected" ? { title: "Connected", tone: "success" as const, description: "Customers can message this number and Tany will reply." }
    : status === "Not connected" ? { title: "Not connected", tone: "neutral" as const, description: "Connect your WhatsApp Business number to start messaging customers." }
      : status.includes("unverified") ? { title: "Setup in progress", tone: "warning" as const, description: "Finish setup to start receiving customer messages." }
        : { title: status, tone: "warning" as const, description: "Reconnect WhatsApp to resume messaging." };

/** Business WhatsApp page. `detailed` is the diagnostics view with account identifiers. */
export async function BusinessWhatsApp({ businessId, detailed = false }: { businessId: string; detailed?: boolean }) {
  const account = await getPostgresBusinessAccount(businessId);
  const status = account?.status ?? "Not connected";
  const copy = statusCopy(status);
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
        <div className="shrink-0">
          <WhatsAppAccountActions status={status} hasConfiguredPhone={!!account?.phoneNumberId} businessId={businessId} />
        </div>
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
        : <WhatsAppDiagnostics businessId={businessId} />}
    </div>
  );
}
