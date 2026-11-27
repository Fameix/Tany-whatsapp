import Link from "next/link";
import { Building2, MessageCircle, MessagesSquare, FileText } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Card } from "@/components/ui/card";
import { getPostgresDirectoryOverview } from "@/lib/admin/postgres-directory";
import { WhatsAppAccountActions } from "@/app/dashboard/messaging/_components/whatsapp-account-actions";

export async function PostgresDirectoryOverview({ accountsOnly = false, businessId, showConnectionCta = false }: { accountsOnly?: boolean; businessId?: string; showConnectionCta?: boolean }) {
  const data = await getPostgresDirectoryOverview();
  const accounts = businessId ? data.accounts.filter((account) => account.businessId === businessId) : data.accounts;
  const business = businessId ? data.businesses.find((item) => item.id === businessId) : null;
  const account = accounts[0] ?? null;
  const metrics = [
    ["Businesses", data.totals.businesses, Building2],
    ["Configured WhatsApp accounts", data.totals.accounts, MessageCircle],
    ["Conversations mirrored", data.totals.conversations, MessagesSquare],
    ["Templates mirrored", data.totals.templates, FileText],
  ] as const;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
        <h1 className="text-2xl font-semibold tracking-tight">{accountsOnly ? "WhatsApp Accounts" : "Overview"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{showConnectionCta && business ? `Connect and manage WhatsApp for ${business.name}.` : "Directory and WhatsApp account status for every business."}</p>
        </div>
        {showConnectionCta && business && <WhatsAppAccountActions status={account?.status ?? "Not connected"} hasConfiguredPhone={!!account?.phoneNumberId} businessId={business.id} />}
      </div>
      {!accountsOnly && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([label, value, Icon]) => <Card key={label} className="gap-2 p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{label}</p><Icon className="size-4 text-muted-foreground" /></div><p className="text-2xl font-semibold tabular-nums">{value}</p></Card>)}</div>}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">Business WhatsApp status</div>
        {accounts.length ? <div className="divide-y">{accounts.map((account) => <Link key={account.businessId} href={`/business/${encodeURIComponent(account.businessId)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"><BrandLogo vertical={account.vertical} decorative /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{account.business}</p><p className="truncate text-xs text-muted-foreground">{account.displayName} · {account.phone ?? "No number connected"}</p></div><span className="rounded-md border px-2 py-1 text-xs">{account.status}</span></Link>)}</div> : <p className="p-8 text-center text-sm text-muted-foreground">{business ? "No WhatsApp account has been configured for this business." : "No businesses to display."}</p>}
      </Card>
    </div>
  );
}
