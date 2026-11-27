import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { businessWorkspacePath } from "@/lib/admin/workspace-path";
import type { ReactNode } from "react";
import { cn } from "cn";
import type { ProductBusiness } from "@/lib/admin/product-center";
import { tenantKindLabel } from "@/lib/admin/tenant-classification";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import { Initials } from "@/app/business/_components/home/home-primitives";

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

export function ProductStatus({ status }: { status: "live" | "coming_soon" }) {
  return status === "live"
    ? <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-800"><span className="size-1.5 rounded-full bg-emerald-500" />Live</span>
    : <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">Coming soon</span>;
}

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
type BusinessTableRow = Pick<ProductBusiness, "id" | "name" | "product" | "kind" | "active" | "whatsapp" | "createdAt" | "lastActivity">;

export function BusinessTable<T extends BusinessTableRow>({ businesses, showKind = false, showProduct = true, openLabel = "Open", primaryWorkspace = false, actions, layout = "table" }: { businesses: T[]; showKind?: boolean; showProduct?: boolean; openLabel?: string; primaryWorkspace?: boolean; actions?: (business: T) => ReactNode; layout?: "table" | "list" }) {
  // Product dashboards use the same simple rows as a business's Home.
  if (layout === "list")
    return (
      <ul className={cn(surface, "flex flex-col px-2 py-2 sm:px-4")}>
        {businesses.map(business => (
          <li key={business.id} className="flex items-center gap-4 rounded-lg px-2 py-3">
            <Initials name={business.name} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                <span className="truncate">{business.name}</span>
                {business.kind !== "live" && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{tenantKindLabel[business.kind]}</span>}
                {!business.active && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Inactive</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <WhatsAppState state={business.whatsapp} />
                {showProduct && business.product && <span>{verticalConfig[business.product].label}</span>}
                <span className="tabular-nums">{business.lastActivity ? `Last activity ${shortDate(business.lastActivity)}` : "No activity yet"}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Link href={businessWorkspacePath(business.id)} className={cn(buttonVariants({ variant: primaryWorkspace ? "default" : "ghost", size: "sm" }), "whitespace-nowrap")}>{openLabel}</Link>
              {actions?.(business)}
            </div>
          </li>
        ))}
      </ul>
    );
  return (
    <div className={cn(surface, "overflow-hidden")}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium sm:px-6">Business</th>
            {showProduct && <th className="hidden px-4 py-2.5 font-medium md:table-cell">Product</th>}
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
                {!showKind && business.kind === "test" && <span className="text-xs font-medium text-muted-foreground">Test</span>}
                <p className="mt-1 sm:hidden"><WhatsAppState state={business.whatsapp} /></p>
              </td>
              {showProduct && <td className="hidden px-4 py-3 text-xs md:table-cell">{business.product ? verticalConfig[business.product].label : "Unknown"}</td>}
              {showKind && <td className="hidden px-4 py-3 text-xs sm:table-cell">{tenantKindLabel[business.kind]}</td>}
              <td className="hidden px-4 py-3 sm:table-cell"><WhatsAppState state={business.whatsapp} /></td>
              <td className="hidden px-4 py-3 text-xs lg:table-cell">{business.active ? "Active" : "Inactive"}</td>
              <td className="hidden px-4 py-3 text-xs text-muted-foreground tabular-nums lg:table-cell">{shortDate(showKind ? business.createdAt : business.lastActivity)}{showKind && business.lastActivity ? <span className="block">Last activity {shortDate(business.lastActivity)}</span> : null}</td>
              <td className="px-4 py-3 text-right sm:px-6">
                <div className="flex flex-wrap justify-end gap-1">
                  <Link href={businessWorkspacePath(business.id)} className={cn(buttonVariants({ variant: primaryWorkspace ? "default" : "ghost", size: "sm" }), "min-h-10 whitespace-nowrap")}>{openLabel}</Link>
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
