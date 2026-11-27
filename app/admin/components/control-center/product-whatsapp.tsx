import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCheck, ChevronDown, ChevronRight, FileText, Store, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppAccountActions } from "@/app/dashboard/messaging/_components/whatsapp-account-actions";
import { WhatsAppConnection } from "@/app/dashboard/messaging/_components/whatsapp-connection";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { StatusDot, Surface } from "@/app/business/_components/home/home-primitives";
import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { getProductWhatsAppDiagnostics } from "@/lib/admin/product-whatsapp-diagnostics";
import { listProductProfiles } from "@/lib/admin/product-scope";
import { adminProductPath } from "@/lib/admin/product-routes";
import { stagingAdminWhatsAppUrl } from "@/lib/admin/staging-environment";
import { formatPhone } from "@/lib/dashboard/business-home";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { embeddedSignupClientConfiguration } from "@/lib/whatsapp/embedded-signup-service";
import { verticalConfig, type ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { EmptyPanel, PageHeader } from "./ui";
import { RefreshWhatsAppStatus, WhatsAppBusinessSelector } from "./whatsapp-selection";

const formatTime = (value: string | null | undefined) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) : "Not recorded";
};

/** Same wording as a business's own WhatsApp page. */
const statusCopy = (status: string) =>
  status === "Connected" ? { title: "Connected", tone: "success" as const, description: "Customers can message this number and Tany will reply." }
    : status === "Inactive" ? { title: "Business inactive", tone: "neutral" as const, description: "This business is deactivated. Activate it in Test & Staging or its profile to manage WhatsApp." }
    : status === "Not connected" ? { title: "Not connected", tone: "neutral" as const, description: "Connect this business's WhatsApp number to start messaging customers." }
      : status.includes("unverified") ? { title: "Setup in progress", tone: "warning" as const, description: "Finish setup to start receiving customer messages." }
        : { title: status, tone: "warning" as const, description: "Reconnect WhatsApp to resume messaging." };

function LinkRow({ href, icon: Icon, label, description }: { href: string; icon: LucideIcon; label: string; description: string }) {
  return (
    <li>
      <Link href={href} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </li>
  );
}

export async function ProductWhatsApp({ product, query, includeTestData, local }: {
  product: ActiveTanyVertical; query: { business?: string | string[]; setup?: string | string[] }; includeTestData: boolean; local: boolean;
}) {
  const businesses = await listProductProfiles(product, includeTestData);
  const root = `${adminProductPath(product)}/whatsapp`;
  const selected = businesses.find(item => item.id === query.business) ?? businesses[0];
  if (query.business !== undefined && !businesses.some(item => item.id === query.business)) notFound();
  if (!selected) return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
    <PageHeader title="WhatsApp" description={`WhatsApp connections for ${verticalConfig[product].label}.`} />
    <EmptyPanel title="No businesses to manage" detail="Add a business to this product, or include test data in staging." />
  </div>;

  const businessId = selected.id;
  const id = encodeURIComponent(businessId);
  const dashboardHref = `${root}?business=${id}`;
  const setupHref = `${dashboardHref}&setup=1`;
  const endpoint = `/api/admin/products/${product}/whatsapp/${id}`;
  const [account, diagnostics] = await Promise.all([
    getPostgresBusinessAccount(businessId),
    getProductWhatsAppDiagnostics(businessId),
  ]);
  const status = account?.status ?? "Not connected";
  const copy = statusCopy(status);
  const connected = status === "Connected";
  const canManage = selected.active && !local;
  const setup = canManage && !connected && query.setup === "1" ? await getClientWhatsAppConnection(businessId) : null;
  const identity = [account?.accountId ? account.displayName : "", account?.phone ? formatPhone(account.phone) : ""].filter(Boolean).join(" · ");
  const rows = [
    ["Webhook health", diagnostics?.webhook_status ?? diagnostics?.webhook_processing ?? "Not recorded"],
    ["Message status", diagnostics?.last_delivery ?? "Not recorded"],
    ["Display-name status", diagnostics?.display_name_status ?? "Not recorded"],
    ["Phone quality", diagnostics?.quality ?? "Not recorded"],
    ["Last webhook", formatTime(diagnostics?.last_webhook)],
    ["Last incoming message", formatTime(diagnostics?.last_incoming)],
    ["Last outgoing message", formatTime(diagnostics?.last_outgoing)],
    ["Last status update", formatTime(account?.at)],
  ];
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
    <PageHeader title="WhatsApp" description={`WhatsApp connections for ${verticalConfig[product].label}.`} />
    <WhatsAppBusinessSelector root={root} businessId={businessId} businesses={businesses.map(({ id, name }) => ({ id, name }))} />
    {local && <LocalWhatsAppNotice businessId={businessId} adminHref={stagingAdminWhatsAppUrl(product, businessId)} />}

    <Surface className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex min-w-0 items-start gap-4">
        <span className="mt-2"><StatusDot tone={copy.tone} /></span>
        <div className="min-w-0">
          <p className="text-base font-semibold">{copy.title}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground tabular-nums">{selected.name}{identity ? ` · ${identity}` : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && <WhatsAppAccountActions key={`${businessId}/${status}/${account?.at}`}
          businessId={businessId} status={status} hasConfiguredPhone={!!account?.phoneNumberId}
          setupHref={setupHref} {...(connected ? { reconnectHref: setupHref } : {})} disconnectEndpoint={`${endpoint}?action=disconnect`} />}
        <RefreshWhatsAppStatus />
      </div>
    </Surface>

    {setup && (setup.status === "connected"
      ? <p className="rounded-lg bg-muted px-4 py-3 text-sm">Disconnect the existing account before starting setup again.</p>
      : <div className="flex justify-center"><WhatsAppConnection key={businessId} businessId={businessId} initialConnection={setup}
        embeddedSignup={embeddedSignupClientConfiguration()} dashboardHref={dashboardHref} signupEndpoint={`${endpoint}?action=signup`}
        connectLabel={status === "Configured · unverified" ? "Continue setup with Meta" : status === "Disconnected" || status === "Error" ? "Reconnect with Meta" : "Connect WhatsApp with Meta"} /></div>)}

    <Surface className="overflow-hidden">
      <ul className="divide-y divide-border/60">
        <LinkRow href={`${root}/${id}/profile`} icon={Store} label="Business profile" description="Display name, profile picture and profile completeness" />
        <LinkRow href={`/business/${id}/templates`} icon={FileText} label="Templates" description="Approved messages this business can send" />
        <LinkRow href={`${adminProductPath(product)}/message-status`} icon={CheckCheck} label="Message status" description="Delivery and read status of recent messages" />
      </ul>
    </Surface>

    <details className="group rounded-xl bg-muted/40 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-muted-foreground">
        Diagnostics<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}
      </dl>
    </details>

    <Button asChild variant="ghost" className="self-start"><Link href={`/business/${id}`}>Open business workspace</Link></Button>
  </div>;
}
