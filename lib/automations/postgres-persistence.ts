import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import type { TenantRow } from "@/lib/data/types";

export type AutomationTable = "automations" | "automation_events" | "automation_runs" | "automation_states" | "templates";
type DbRow = Record<string, unknown>;
const rows = async (query: ReturnType<ReturnType<typeof postgresDb>["execute"]>) => (await query as unknown as { rows?: DbRow[] }).rows ?? [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: unknown) => value instanceof Date ? value : typeof value === "number" ? new Date(value) : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as DbRow : {};
const json = (value: unknown) => JSON.stringify(value ?? {});

async function tenantId(businessId: string) {
  const result = await rows(postgresDb().execute(sql`select id from messaging_businesses where legacy_business_id = ${businessId} limit 2`));
  if (result.length !== 1) throw new Error("POSTGRES_TENANT_UNMAPPED");
  return text(result[0].id);
}

function hydrated(table: AutomationTable, row: DbRow, businessId: string): TenantRow {
  const payload = object(table === "automations" ? row.definition : table === "automation_events" ? row.event : table === "automation_runs" ? row.run : table === "automation_states" ? row.state : row.definition);
  const id = table === "templates" ? text(row.legacy_template_id) : text(row.id);
  return {
    ...payload, id, businessId, status: text(row.status) || payload.status,
    ...(table === "automations" ? { product: text(row.product) || payload.product, createdAt: row.created_at, updatedAt: row.updated_at, publishedAt: row.published_at } : {}),
    ...(table === "automation_events" ? { automationIds: row.automation_ids, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at } : {}),
    ...(table === "automation_runs" ? { automationId: text(row.automation_id), trigger: text(row.trigger), startedAt: row.started_at, updatedAt: row.updated_at, completedAt: row.completed_at, resumeAt: row.resume_at } : {}),
    ...(table === "templates" ? { name: text(row.name), language: text(row.language), category: text(row.category), body: text(row.body), variables: row.variables, createdAt: row.created_at, updatedAt: row.updated_at } : {}),
  };
}

export class PostgresAutomationPersistence {
  async findRun(id: string) {
    const result = await rows(postgresDb().execute(sql`select r.*, b.legacy_business_id from automation_runs r join messaging_businesses b on b.id=r.messaging_business_id where r.id=${id} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_AUTOMATION_ROW_INCONSISTENT");
    return result[0] ? hydrated("automation_runs", result[0], text(result[0].legacy_business_id)) : null;
  }
  async list(table: AutomationTable, businessId: string, status?: string) {
    const business = await tenantId(businessId); let result: DbRow[];
    if (table === "automations") result = await rows(postgresDb().execute(sql`select * from automation_definitions where messaging_business_id = ${business} and (${status ?? null}::text is null or status = ${status ?? null}) order by created_at`));
    else if (table === "automation_events") result = await rows(postgresDb().execute(sql`select * from automation_events where messaging_business_id = ${business} and (${status ?? null}::text is null or status = ${status ?? null}) order by created_at`));
    else if (table === "automation_runs") result = await rows(postgresDb().execute(sql`select * from automation_runs where messaging_business_id = ${business} and (${status ?? null}::text is null or status = ${status ?? null}) order by started_at`));
    else if (table === "automation_states") result = await rows(postgresDb().execute(sql`select * from automation_states where messaging_business_id = ${business} and (${status ?? null}::text is null or status = ${status ?? null}) order by created_at`));
    else result = await rows(postgresDb().execute(sql`select * from whatsapp_templates where messaging_business_id = ${business} and (${status ?? null}::text is null or status = ${status ?? null}) order by created_at`));
    return result.map(row => hydrated(table, row, businessId));
  }
  async get(table: AutomationTable, businessId: string, id: string) {
    const business = await tenantId(businessId); let result: DbRow[];
    if (table === "automations") result = await rows(postgresDb().execute(sql`select * from automation_definitions where messaging_business_id = ${business} and id = ${id} limit 2`));
    else if (table === "automation_events") result = await rows(postgresDb().execute(sql`select * from automation_events where messaging_business_id = ${business} and id = ${id} limit 2`));
    else if (table === "automation_runs") result = await rows(postgresDb().execute(sql`select * from automation_runs where messaging_business_id = ${business} and id = ${id} limit 2`));
    else if (table === "automation_states") result = await rows(postgresDb().execute(sql`select * from automation_states where messaging_business_id = ${business} and id = ${id} limit 2`));
    else result = await rows(postgresDb().execute(sql`select * from whatsapp_templates where messaging_business_id = ${business} and legacy_template_id = ${id} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_AUTOMATION_ROW_INCONSISTENT");
    return result[0] ? hydrated(table, result[0], businessId) : null;
  }
  async create(table: AutomationTable, row: TenantRow) {
    const business = await tenantId(row.businessId); let inserted: DbRow[];
    if (table === "automations") inserted = await rows(postgresDb().execute(sql`insert into automation_definitions (id, messaging_business_id, product, status, definition, published_at, created_at, updated_at) values (${row.id}, ${business}, ${text(row.product)}, ${text(row.status) || "draft"}, ${json(row)}::jsonb, ${date(row.publishedAt)}, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do nothing returning id`));
    else if (table === "automation_events") inserted = await rows(postgresDb().execute(sql`insert into automation_events (id, messaging_business_id, status, event, automation_ids, completed_at, created_at, updated_at) values (${row.id}, ${business}, ${text(row.status) || "pending"}, ${json(row)}::jsonb, ${json(Array.isArray(row.automationIds) ? row.automationIds : [])}::jsonb, ${date(row.completedAt)}, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do nothing returning id`));
    else if (table === "automation_runs") inserted = await rows(postgresDb().execute(sql`insert into automation_runs (id, messaging_business_id, automation_id, trigger, status, run, resume_at, started_at, completed_at, updated_at) values (${row.id}, ${business}, ${text(row.automationId)}, ${text(row.trigger)}, ${text(row.status) || "running"}, ${json(row)}::jsonb, ${date(row.resumeAt)}, coalesce(${date(row.startedAt)}, now()), ${date(row.completedAt)}, now()) on conflict (id) do nothing returning id`));
    else if (table === "automation_states") inserted = await rows(postgresDb().execute(sql`insert into automation_states (id, messaging_business_id, automation_id, conversation_id, status, state, created_at, updated_at) values (${row.id}, ${business}, ${text(row.automationId) || null}, ${text(row.conversationId) || null}, ${text(row.status) || "active"}, ${json(row)}::jsonb, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do nothing returning id`));
    else inserted = await rows(postgresDb().execute(sql`insert into whatsapp_templates (messaging_business_id, legacy_template_id, meta_template_id, name, language, category, status, body, variables, definition, created_at, updated_at) values (${business}, ${row.id}, ${text(row.metaTemplateId) || null}, ${text(row.name)}, ${text(row.language) || "en"}, ${text(row.category) || null}, ${text(row.status) || "draft"}, ${text(row.body)}, ${json(object(row.variables))}::jsonb, ${json(row)}::jsonb, coalesce(${date(row.createdAt)}, now()), now()) on conflict (messaging_business_id, legacy_template_id) do nothing returning id`));
    return inserted.length === 1;
  }
  async upsert(table: AutomationTable, row: TenantRow) {
    const business = await tenantId(row.businessId);
    if (table === "automations") await postgresDb().execute(sql`insert into automation_definitions (id, messaging_business_id, product, status, definition, published_at, created_at, updated_at) values (${row.id}, ${business}, ${text(row.product)}, ${text(row.status) || "draft"}, ${json(row)}::jsonb, ${date(row.publishedAt)}, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do update set product=excluded.product, status=excluded.status, definition=excluded.definition, published_at=excluded.published_at, updated_at=now() where automation_definitions.messaging_business_id=excluded.messaging_business_id`);
    else if (table === "automation_events") await postgresDb().execute(sql`insert into automation_events (id, messaging_business_id, status, event, automation_ids, completed_at, created_at, updated_at) values (${row.id}, ${business}, ${text(row.status) || "pending"}, ${json(row)}::jsonb, ${json(Array.isArray(row.automationIds) ? row.automationIds : [])}::jsonb, ${date(row.completedAt)}, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do update set status=excluded.status, event=excluded.event, automation_ids=excluded.automation_ids, completed_at=excluded.completed_at, updated_at=now() where automation_events.messaging_business_id=excluded.messaging_business_id`);
    else if (table === "automation_runs") await postgresDb().execute(sql`insert into automation_runs (id, messaging_business_id, automation_id, trigger, status, run, resume_at, started_at, completed_at, updated_at) values (${row.id}, ${business}, ${text(row.automationId)}, ${text(row.trigger)}, ${text(row.status) || "running"}, ${json(row)}::jsonb, ${date(row.resumeAt)}, coalesce(${date(row.startedAt)}, now()), ${date(row.completedAt)}, now()) on conflict (id) do update set status=excluded.status, run=excluded.run, resume_at=excluded.resume_at, completed_at=excluded.completed_at, updated_at=now() where automation_runs.messaging_business_id=excluded.messaging_business_id`);
    else if (table === "automation_states") await postgresDb().execute(sql`insert into automation_states (id, messaging_business_id, automation_id, conversation_id, status, state, created_at, updated_at) values (${row.id}, ${business}, ${text(row.automationId) || null}, ${text(row.conversationId) || null}, ${text(row.status) || "active"}, ${json(row)}::jsonb, coalesce(${date(row.createdAt)}, now()), now()) on conflict (id) do update set status=excluded.status, state=excluded.state, updated_at=now() where automation_states.messaging_business_id=excluded.messaging_business_id`);
    else await postgresDb().execute(sql`insert into whatsapp_templates (messaging_business_id, legacy_template_id, meta_template_id, name, language, category, status, body, variables, definition, created_at, updated_at) values (${business}, ${row.id}, ${text(row.metaTemplateId) || null}, ${text(row.name)}, ${text(row.language) || "en"}, ${text(row.category) || null}, ${text(row.status) || "draft"}, ${text(row.body)}, ${json(object(row.variables))}::jsonb, ${json(row)}::jsonb, coalesce(${date(row.createdAt)}, now()), now()) on conflict (messaging_business_id, name, language) do update set legacy_template_id=excluded.legacy_template_id, meta_template_id=excluded.meta_template_id, category=excluded.category, status=excluded.status, body=excluded.body, variables=excluded.variables, definition=excluded.definition, updated_at=now()`);
  }
  async update(table: AutomationTable, businessId: string, id: string, patch: DbRow) { const current = await this.get(table, businessId, id); if (!current) throw new Error("Automation row not found."); const row = { ...current, ...patch, id, businessId }; await this.upsert(table, row); return row; }
  async delete(table: AutomationTable, businessId: string, id: string) {
    const business = await tenantId(businessId);
    if (table === "automations") await postgresDb().execute(sql`delete from automation_definitions where messaging_business_id=${business} and id=${id}`);
    else if (table === "automation_events") await postgresDb().execute(sql`delete from automation_events where messaging_business_id=${business} and id=${id}`);
    else if (table === "automation_runs") await postgresDb().execute(sql`delete from automation_runs where messaging_business_id=${business} and id=${id}`);
    else if (table === "automation_states") await postgresDb().execute(sql`delete from automation_states where messaging_business_id=${business} and id=${id}`);
    else await postgresDb().execute(sql`delete from whatsapp_templates where messaging_business_id=${business} and legacy_template_id=${id}`);
  }
}
