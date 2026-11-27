import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhatsAppAccountActions } from "@/app/dashboard/messaging/_components/whatsapp-account-actions";
import { WhatsAppConnection } from "@/app/dashboard/messaging/_components/whatsapp-connection";
import { LocalWhatsAppNotice } from "@/app/business/_components/local-whatsapp-notice";
import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { getProductWhatsAppDiagnostics } from "@/lib/admin/product-whatsapp-diagnostics";
import { listProductProfiles } from "@/lib/admin/product-scope";
import { adminProductPath } from "@/lib/admin/product-routes";
import { stagingAdminWhatsAppUrl } from "@/lib/admin/staging-environment";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { embeddedSignupClientConfiguration } from "@/lib/whatsapp/embedded-signup-service";
import { verticalConfig, type ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { EmptyPanel, PageHeader, surface } from "./ui";
import { RefreshWhatsAppStatus, WhatsAppBusinessSelector } from "./whatsapp-selection";

const formatTime = (value: string | null | undefined) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date) : "Not recorded";
};

export async function ProductWhatsApp({ product, query, includeTestData, local }: {
  product: ActiveTanyVertical; query: { business?: string | string[]; setup?: string | string[] }; includeTestData: boolean; local: boolean;
}) {
  const businesses = await listProductProfiles(product, includeTestData);
  const root = `${adminProductPath(product)}/whatsapp`;
  const selected = businesses.find(item => item.id === query.business) ?? businesses[0];
  if (query.business !== undefined && !businesses.some(item => item.id === query.business)) notFound();
  if (!selected) return <div className="space-y-4">
    <PageHeader title="WhatsApp" description={verticalConfig[product].label} />
    <EmptyPanel title="No businesses to manage" detail="Add a business to this product or include test data in staging." />
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
  const displayStatus = status === "Configured · unverified" ? "Setup incomplete" : status;
  const connected = status === "Connected";
  const canManage = selected.active && !local;
  const setup = canManage && !connected && query.setup === "1" ? await getClientWhatsAppConnection(businessId) : null;
  const rows = [
    ["Webhook health", diagnostics?.webhook_status ?? diagnostics?.webhook_processing ?? "Not recorded"],
    ["Message status", diagnostics?.last_delivery ?? "Not recorded"],
    ["Display-name status", diagnostics?.display_name_status ?? "Not recorded"],
    ["Phone quality", diagnostics?.quality ?? "Not recorded"],
    ["Last webhook", formatTime(diagnostics?.last_webhook)],
    ["Last incoming message", formatTime(diagnostics?.last_incoming)],
    ["Last outgoing message", formatTime(diagnostics?.last_outgoing)],
  ];
  return <div className="mx-auto max-w-4xl space-y-4">
    <PageHeader title="WhatsApp" description={`Manage WhatsApp connections for ${verticalConfig[product].label}.`} />
    <WhatsAppBusinessSelector root={root} businessId={businessId} businesses={businesses.map(({ id, name }) => ({ id, name }))} />
    {local && <LocalWhatsAppNotice businessId={businessId} adminHref={stagingAdminWhatsAppUrl(product, businessId)} />}
    <section aria-label="Connection" className={`${surface} space-y-4 p-4 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-lg font-semibold">{selected.name}</h2><p className="text-sm text-muted-foreground">WhatsApp connection</p></div>
        <Badge variant={connected ? "secondary" : "outline"}>{displayStatus}</Badge>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["WhatsApp display name", account?.accountId ? account.displayName : "Not available"],
          ["Phone number", account?.phone ?? "Not available"],
          ["Last status update", formatTime(account?.at)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && connected && <Button asChild><a href="#manage-connection">Manage connection</a></Button>}
        {canManage && !connected && <WhatsAppAccountActions key={`${businessId}/${status}/${account?.at}`}
          businessId={businessId} status={status} hasConfiguredPhone={!!account?.phoneNumberId}
          setupHref={setupHref} disconnectEndpoint={`${endpoint}?action=disconnect`} />}
        <RefreshWhatsAppStatus />
      </div>
    </section>
    {setup && (setup.status === "connected"
      ? <p className="rounded-lg border p-4 text-sm">Disconnect the existing account before starting setup again.</p>
      : <div className="flex justify-center"><WhatsAppConnection key={businessId} businessId={businessId} initialConnection={setup}
        embeddedSignup={embeddedSignupClientConfiguration()} dashboardHref={dashboardHref} signupEndpoint={`${endpoint}?action=signup`}
        connectLabel={status === "Configured · unverified" ? "Continue setup with Meta" : status === "Disconnected" || status === "Error" ? "Reconnect with Meta" : "Connect WhatsApp with Meta"} /></div>)}
    <section id="manage-connection" aria-label="Business profile" className={`${surface} flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6`}>
      <div><h2 className="font-semibold">Business profile</h2><p className="text-sm text-muted-foreground">Manage how this business appears on WhatsApp.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && connected && <WhatsAppAccountActions key={`${businessId}/${status}/${account?.at}`}
          businessId={businessId} status={status} hasConfiguredPhone={!!account?.phoneNumberId}
          setupHref={setupHref} reconnectHref={setupHref} disconnectEndpoint={`${endpoint}?action=disconnect`} />}
        <Button asChild variant="outline"><Link href={`${root}/${id}/profile`}>Manage business profile</Link></Button>
      </div>
    </section>
    <details className={`${surface} p-4 sm:p-6`}>
      <summary className="cursor-pointer font-semibold">Diagnostics</summary>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}
      </dl>
    </details>
    <Button asChild variant="ghost"><Link href={`/business/${id}`} title="Open this business’s full workspace">Open workspace</Link></Button>
  </div>;
}
