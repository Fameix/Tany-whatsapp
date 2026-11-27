import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import { tanyProducts, type TanyProduct } from "@/lib/messaging/vertical-config";
import type { TanyVertical } from "@/lib/messaging/types";
import { classifyTenant, type TenantKind } from "./tenant-classification";
import { PostgresDirectoryError } from "./postgres-directory";

export type ProductBusiness = {
  id: string;
  name: string;
  product: TanyVertical | null;
  kind: TenantKind;
  active: boolean;
  createdAt: string | null;
  whatsapp: "connected" | "setup" | "disconnected" | "not_connected";
  displayPhone: string;
  conversations: number;
  conversationsToday: number;
  customers: number;
  activeAutomations: number;
  campaigns: number;
  templates: number;
  approvedTemplates: number;
  incoming24h: number;
  outgoing24h: number;
  failed24h: number;
  lastActivity: string | null;
};

export type Totals = {
  businesses: number; connected: number; conversations: number; conversationsToday: number; customers: number;
  activeAutomations: number; campaigns: number; templates: number; approvedTemplates: number;
  incoming24h: number; outgoing24h: number; failed24h: number; lastActivity: string | null;
};
export type MessagingHealth = "healthy" | "delivery_issues" | "quiet";
export type ProductSummary = TanyProduct & { totals: Totals; health: MessagingHealth };

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const int = (value: unknown) => (typeof value === "number" ? value : Number.parseInt(text(value), 10) || 0);
const iso = (value: unknown) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === "string" && value ? new Date(value).toISOString() : null);
const products = new Set<string>(tanyProducts.map(product => product.id));

/** Start of today in India (Tany's operating timezone), as a UTC instant. */
export function startOfTodayIst(now = Date.now()) {
  const offset = 330 * 60_000;
  const local = new Date(now + offset);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset);
}

function whatsappState(row: Row): ProductBusiness["whatsapp"] {
  const status = text(row.account_status);
  const configured = !!text(row.phone_number_id);
  const verified = row.test_passed === true && text(row.validation_mode) === "live" && !!row.tested_at;
  if (configured && status === "connected" && verified) return "connected";
  if (status === "disconnected") return "disconnected";
  if (configured || status === "pending" || status === "testing") return "setup";
  return "not_connected";
}

/** Every business with its WhatsApp state and activity counts, from Postgres only. */
export async function listProductBusinesses(now = Date.now()): Promise<ProductBusiness[]> {
  const today = startOfTodayIst(now);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  let rows: Row[];
  try {
    rows = ((await postgresDb().execute(sql`
      select b.legacy_business_id, b.name, b.vertical, b.status, b.settings, b.created_at,
        a.status as account_status, a.phone_number_id, a.display_phone, a.test_passed, a.validation_mode, a.tested_at,
        coalesce(c.total, 0) as conversations, coalesce(c.today, 0) as conversations_today,
        coalesce(ct.total, 0) as customers,
        coalesce(au.active, 0) as active_automations,
        coalesce(t.total, 0) as templates, coalesce(t.approved, 0) as approved_templates,
        coalesce(cp.total, 0) as campaigns,
        coalesce(m.incoming, 0) as incoming_24h, coalesce(m.outgoing, 0) as outgoing_24h, coalesce(m.failed, 0) as failed_24h,
        m.last_at
      from messaging_businesses b
      left join whatsapp_accounts a on a.messaging_business_id = b.id
      left join lateral (
        select count(*)::int as total,
          count(*) filter (where last_incoming_at >= ${today} or last_outgoing_at >= ${today})::int as today
        from whatsapp_conversations where messaging_business_id = b.id) c on true
      left join lateral (select count(*)::int as total from whatsapp_contacts where messaging_business_id = b.id) ct on true
      left join lateral (select count(*) filter (where status = 'active')::int as active from automation_definitions where messaging_business_id = b.id) au on true
      left join lateral (select count(*)::int as total, count(*) filter (where status = 'approved')::int as approved from whatsapp_templates where messaging_business_id = b.id) t on true
      left join lateral (select count(*)::int as total from messaging_runtime_records where messaging_business_id = b.id and collection = 'campaigns') cp on true
      left join lateral (
        select max(created_at) as last_at,
          count(*) filter (where direction = 'incoming' and created_at >= ${dayAgo})::int as incoming,
          count(*) filter (where direction = 'outgoing' and created_at >= ${dayAgo})::int as outgoing,
          count(*) filter (where direction = 'outgoing' and delivery_status = 'failed' and created_at >= ${dayAgo})::int as failed
        from whatsapp_messages where messaging_business_id = b.id) m on true
      order by b.name asc
    `)) as unknown as { rows?: Row[] }).rows ?? [];
  } catch (error) {
    console.error("[PRODUCT_CENTER_READ_FAILED]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    throw new PostgresDirectoryError();
  }
  return rows.flatMap(row => {
    const id = text(row.legacy_business_id);
    if (!id) return [];
    const vertical = text(row.vertical);
    return [{
      id, name: text(row.name) || id,
      product: products.has(vertical) ? vertical as TanyVertical : null,
      kind: classifyTenant({ id, settings: row.settings }),
      active: text(row.status) === "active",
      createdAt: iso(row.created_at),
      whatsapp: whatsappState(row),
      displayPhone: text(row.display_phone),
      conversations: int(row.conversations), conversationsToday: int(row.conversations_today), customers: int(row.customers),
      activeAutomations: int(row.active_automations), campaigns: int(row.campaigns),
      templates: int(row.templates), approvedTemplates: int(row.approved_templates),
      incoming24h: int(row.incoming_24h), outgoing24h: int(row.outgoing_24h), failed24h: int(row.failed_24h),
      lastActivity: iso(row.last_at),
    }];
  });
}

/** Product metrics count real (live) businesses only; test, demo and migration tenants are excluded. */
export const realBusinesses = (businesses: ProductBusiness[]) => businesses.filter(business => business.kind === "live");

export function totalsFor(businesses: ProductBusiness[]): Totals {
  const sum = (key: keyof ProductBusiness) => businesses.reduce((total, business) => total + (business[key] as number), 0);
  return {
    businesses: businesses.filter(business => business.active).length,
    connected: businesses.filter(business => business.whatsapp === "connected").length,
    conversations: sum("conversations"), conversationsToday: sum("conversationsToday"), customers: sum("customers"),
    activeAutomations: sum("activeAutomations"), campaigns: sum("campaigns"), templates: sum("templates"), approvedTemplates: sum("approvedTemplates"),
    incoming24h: sum("incoming24h"), outgoing24h: sum("outgoing24h"), failed24h: sum("failed24h"),
    lastActivity: businesses.map(business => business.lastActivity).filter((value): value is string => !!value).sort().at(-1) ?? null,
  };
}

export function messagingHealth(totals: Totals): MessagingHealth {
  if (!totals.incoming24h && !totals.outgoing24h) return "quiet";
  return totals.outgoing24h && totals.failed24h / totals.outgoing24h > 0.05 ? "delivery_issues" : "healthy";
}

/** All 12 products with metrics from real businesses of that product only. */
export function productSummaries(businesses: ProductBusiness[]): ProductSummary[] {
  const real = realBusinesses(businesses);
  return tanyProducts.map(product => {
    const totals = totalsFor(real.filter(business => business.product === product.id));
    return { ...product, totals, health: messagingHealth(totals) };
  });
}
