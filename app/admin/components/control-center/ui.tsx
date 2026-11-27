import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import { DashboardAuthorizationError, requireDashboardAccess } from "@/lib/admin/dashboard-session";
import type { ProductBusiness, MessagingHealth } from "@/lib/admin/product-center";
import { tenantKindLabel } from "@/lib/admin/tenant-classification";
import { verticalConfig } from "@/lib/messaging/vertical-config";

/** Pages render alongside their layout, so every Super Admin page checks access itself
 * before reading any data. */
export async function isSuperAdmin() {
  try { return (await requireDashboardAccess()) === "admin"; }
  catch (error) { if (error instanceof DashboardAuthorizationError) return false; throw error; }
}

export const surface = "rounded-xl bg-card shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]";

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className={cn(surface, "p-4")}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-[26px] font-semibold leading-8 tracking-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function ProductStatus({ status }: { status: "live" | "coming_soon" }) {
  return status === "live"
    ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-800"><span className="size-1.5 rounded-full bg-emerald-500" />Live</span>
    : <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">Coming soon</span>;
}

const healthCopy: Record<MessagingHealth, { label: string; className: string }> = {
  healthy: { label: "Messaging healthy", className: "text-emerald-700" },
  delivery_issues: { label: "Delivery issues", className: "text-primary" },
  quiet: { label: "No messages in 24h", className: "text-muted-foreground" },
};
export const healthLabel = healthCopy;

const whatsappCopy: Record<ProductBusiness["whatsapp"], { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-500" },
  setup: { label: "Setup in progress", dot: "bg-amber-500" },
  disconnected: { label: "Disconnected", dot: "bg-zinc-400" },
  not_connected: { label: "Not connected", dot: "bg-zinc-300" },
};
export function WhatsAppState({ state }: { state: ProductBusiness["whatsapp"] }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs"><span className={cn("size-1.5 rounded-full", whatsappCopy[state].dot)} />{whatsappCopy[state].label}</span>;
}

export const shortDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "—");

/** Compact business rows; columns collapse on small screens. */
export function BusinessTable({ businesses, showKind = false, actions }: { businesses: ProductBusiness[]; showKind?: boolean; actions?: (business: ProductBusiness) => ReactNode }) {
  return (
    <div className={cn(surface, "overflow-hidden")}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium sm:px-6">Business</th>
            <th className="hidden px-4 py-2.5 font-medium md:table-cell">Product</th>
            {showKind && <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Type</th>}
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">WhatsApp</th>
            <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Status</th>
            <th className="hidden px-4 py-2.5 font-medium lg:table-cell">{showKind ? "Created" : "Last activity"}</th>
            <th className="px-4 py-2.5 text-right font-medium sm:px-6">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {businesses.map(business => (
            <tr key={business.id} className="align-middle">
              <td className="max-w-0 px-4 py-3 sm:px-6">
                <p className="truncate font-medium">{business.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{business.id}</p>
                <p className="mt-1 sm:hidden"><WhatsAppState state={business.whatsapp} /></p>
              </td>
              <td className="hidden px-4 py-3 text-xs md:table-cell">{business.product ? verticalConfig[business.product].label : "Unknown"}</td>
              {showKind && <td className="hidden px-4 py-3 text-xs sm:table-cell">{tenantKindLabel[business.kind]}</td>}
              <td className="hidden px-4 py-3 sm:table-cell"><WhatsAppState state={business.whatsapp} /></td>
              <td className="hidden px-4 py-3 text-xs lg:table-cell">{business.active ? "Active" : "Inactive"}</td>
              <td className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums lg:table-cell">{shortDate(showKind ? business.createdAt : business.lastActivity)}{showKind && business.lastActivity ? <span className="block">Last activity {shortDate(business.lastActivity)}</span> : null}</td>
              <td className="px-4 py-3 text-right sm:px-6">
                <div className="flex justify-end gap-1">
                  <Link href={`/business/${encodeURIComponent(business.id)}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium hover:bg-muted">Open</Link>
                  {actions?.(business)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HiddenTenantsNote({ count, href }: { count: number; href: string }) {
  if (!count) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {count} test, demo and migration {count === 1 ? "business is" : "businesses are"} excluded from these numbers.{" "}
      <Link href={href} className="font-medium text-foreground underline-offset-4 hover:underline">View in Test &amp; staging</Link>
    </p>
  );
}

export function EmptyPanel({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className={cn(surface, "flex flex-col items-center gap-1.5 px-6 py-10 text-center")}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-xs leading-5 text-muted-foreground">{detail}</p>
      {action}
    </div>
  );
}
