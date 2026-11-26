import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import type { AdminBusiness, BusinessListItem } from "@/lib/admin/types";
import type { OperationAccount } from "@/lib/admin/operations-types";
import type { TanyVertical } from "@/lib/messaging/types";
import { verticalConfig } from "@/lib/messaging/vertical-config";

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<ReturnType<typeof postgresDb>["execute"]>) => (await query as unknown as { rows?: Row[] }).rows ?? [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const integer = (value: unknown) => typeof value === "number" ? value : Number.parseInt(text(value), 10) || 0;
const iso = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;

export class PostgresDirectoryError extends Error {
  readonly code = "POSTGRES_DIRECTORY_UNAVAILABLE";
  constructor() { super("Postgres business directory is unavailable."); }
}

function vertical(value: unknown): TanyVertical | null {
  const key = text(value) as TanyVertical;
  return key in verticalConfig ? key : null;
}
function profile(row: Row): AdminBusiness | null {
  const key = vertical(row.vertical);
  const id = text(row.legacy_business_id);
  if (!key || !id) return null;
  return { id, name: text(row.name), vertical: key, active: text(row.status) === "active", whatsappPhoneNumberId: text(row.phone_number_id), settings: {} };
}
function account(row: Row, business: AdminBusiness): OperationAccount {
  const configured = !!text(row.phone_number_id);
  const verified = row.test_passed === true && text(row.validation_mode) === "live" && !!row.tested_at;
  const status = !business.active ? "Inactive" : configured && text(row.account_status) === "connected" && verified ? "Connected" : configured && text(row.account_status) === "disconnected" ? "Disconnected" : configured && text(row.account_status) === "error" ? "Error" : configured ? "Configured · unverified" : "Not connected";
  return { accountId: text(row.account_id) || null, businessId: business.id, business: business.name, vertical: business.vertical, phone: text(row.display_phone) || null, displayName: text(row.display_name) || business.name, phoneNumberId: text(row.phone_number_id) || null, wabaId: text(row.waba_id) || null, metadataStatus: text(row.account_status) || undefined, status, quality: "Unknown", subscription: "Unknown", at: iso(row.account_updated_at) };
}

async function directoryRows(): Promise<Row[]> {
  try {
    return await rows(postgresDb().execute(sql`
      select b.legacy_business_id, b.name, b.vertical, b.status,
        a.id as account_id, a.phone_number_id, a.waba_id, a.display_phone, a.display_name,
        a.status as account_status, a.test_passed, a.validation_mode, a.tested_at, a.updated_at as account_updated_at,
        coalesce(c.conversation_count, 0) as conversation_count,
        coalesce(m.message_count, 0) as message_count,
        coalesce(t.template_count, 0) as template_count
      from messaging_businesses b
      left join whatsapp_accounts a on a.messaging_business_id = b.id
      left join lateral (select count(*)::int as conversation_count from whatsapp_conversations c where c.messaging_business_id = b.id) c on true
      left join lateral (select count(*)::int as message_count from whatsapp_messages m where m.messaging_business_id = b.id) m on true
      left join lateral (select count(*)::int as template_count from whatsapp_templates t where t.messaging_business_id = b.id) t on true
      order by b.name asc
    `));
  } catch (error) {
    console.error("[POSTGRES_DIRECTORY_READ_FAILED]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    throw new PostgresDirectoryError();
  }
}

/** Super Admin directory read. Never falls back to Firestore. */
export async function listPostgresBusinessProfiles(): Promise<AdminBusiness[]> {
  return (await directoryRows()).map(profile).filter((item): item is AdminBusiness => !!item);
}

/** Standalone tenant identity lookup for an already-authorized workspace route. */
export async function getPostgresBusinessProfile(businessId: string): Promise<AdminBusiness | null> {
  try {
    const result = await rows(postgresDb().execute(sql`
      select b.legacy_business_id, b.name, b.vertical, b.status, a.phone_number_id
      from messaging_businesses b
      left join whatsapp_accounts a on a.messaging_business_id = b.id
      where b.legacy_business_id = ${businessId}
      limit 1
    `));
    return result[0] ? profile(result[0]) : null;
  } catch (error) {
    console.error("[POSTGRES_BUSINESS_PROFILE_READ_FAILED]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    throw new PostgresDirectoryError();
  }
}

/** Catalog remains Firestore-owned, so it is deliberately not represented as a count here. */
export async function listPostgresBusinesses(): Promise<BusinessListItem[]> {
  return (await directoryRows()).flatMap((row) => {
    const business = profile(row);
    return business ? [{ ...business, catalogCount: 0, conversationCount: integer(row.conversation_count) }] : [];
  });
}

export type PostgresDirectoryOverview = {
  businesses: BusinessListItem[];
  accounts: OperationAccount[];
  totals: { businesses: number; activeBusinesses: number; accounts: number; connectedAccounts: number; conversations: number; messages: number; templates: number };
};

/** Minimal dashboard projection backed only by standalone Messaging Postgres. */
export async function getPostgresDirectoryOverview(): Promise<PostgresDirectoryOverview> {
  const source = await directoryRows();
  const businesses = source.flatMap((row) => {
    const item = profile(row);
    return item ? [{ ...item, catalogCount: 0, conversationCount: integer(row.conversation_count) }] : [];
  });
  const accounts = source.flatMap((row) => {
    const business = profile(row);
    return business ? [account(row, business)] : [];
  });
  return {
    businesses,
    accounts,
    totals: {
      businesses: businesses.length,
      activeBusinesses: businesses.filter((business) => business.active).length,
      accounts: accounts.filter((item) => !!item.phoneNumberId).length,
      connectedAccounts: accounts.filter((item) => item.status === "Connected").length,
      conversations: source.reduce((sum, row) => sum + integer(row.conversation_count), 0),
      messages: source.reduce((sum, row) => sum + integer(row.message_count), 0),
      templates: source.reduce((sum, row) => sum + integer(row.template_count), 0),
    },
  };
}
