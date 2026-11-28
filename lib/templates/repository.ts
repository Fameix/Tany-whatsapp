import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import { databaseMode } from "@/lib/data/repository";
import { metaComponents, templateContentFrom, type TemplateCategory, type TemplateContent, type TemplateStatus } from "./model";

/** A business-owned template. Starter templates are never stored here until a business copies one. */
export type BusinessTemplate = TemplateContent & {
  id: string;
  businessId: string;
  status: TemplateStatus;
  /** Meta may assign a category on review; authentication templates can arrive from Meta. */
  storedCategory: TemplateCategory | "unknown";
  starterKey: string | null;
  metaTemplateId: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
};

export class TemplateNameTakenError extends Error {
  constructor() { super("A template with this name and language already exists."); }
}
export class TemplateStoreUnavailableError extends Error {
  constructor() { super("Template management needs the Postgres messaging store."); }
}

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<ReturnType<typeof postgresDb>["execute"]>) => (await query as unknown as { rows?: Row[] }).rows ?? [];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const iso = (value: unknown) => (value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === "string" ? value : null);
const statuses: TemplateStatus[] = ["draft", "pending", "approved", "rejected"];

function requireStore() {
  if (databaseMode() !== "postgres" && databaseMode() !== "dual-write") throw new TemplateStoreUnavailableError();
}

async function tenantId(businessId: string) {
  const result = await rows(postgresDb().execute(sql`select id from messaging_businesses where legacy_business_id = ${businessId} limit 2`));
  if (result.length !== 1) throw new Error("POSTGRES_TENANT_UNMAPPED");
  return text(result[0].id);
}

function fromRow(row: Row, businessId: string): BusinessTemplate {
  const definition = (row.definition && typeof row.definition === "object" ? row.definition : {}) as Row;
  const content = templateContentFrom({ ...definition, name: row.name, language: row.language, category: row.category, body: row.body });
  const category = text(row.category);
  return {
    ...content,
    id: text(row.legacy_template_id),
    businessId,
    status: statuses.includes(text(row.status) as TemplateStatus) ? (text(row.status) as TemplateStatus) : "draft",
    storedCategory: category === "utility" || category === "marketing" || category === "authentication" ? category : "unknown",
    starterKey: text(definition.starterKey) || null,
    metaTemplateId: text(row.meta_template_id) || null,
    rejectionReason: text(definition.rejectionReason) || null,
    submittedAt: iso(definition.submittedAt),
    updatedAt: iso(row.updated_at),
  };
}

/** The stored definition keeps editor fields plus Meta-format components, which the
 * existing Inbox and Automation senders read through the template persistence layer. */
function definitionFor(content: TemplateContent, extra: Row) {
  return { ...content, components: metaComponents(content), ...extra };
}

const isNameConflict = (error: unknown) => error instanceof Error && /whatsapp_templates_business_name_language_unique|duplicate key/i.test(`${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}`);

export async function listBusinessTemplates(businessId: string): Promise<BusinessTemplate[]> {
  requireStore();
  const business = await tenantId(businessId);
  const result = await rows(postgresDb().execute(sql`select * from whatsapp_templates where messaging_business_id = ${business} order by updated_at desc`));
  return result.map(row => fromRow(row, businessId));
}

export async function getBusinessTemplate(businessId: string, id: string): Promise<BusinessTemplate | null> {
  requireStore();
  const business = await tenantId(businessId);
  const result = await rows(postgresDb().execute(sql`select * from whatsapp_templates where messaging_business_id = ${business} and legacy_template_id = ${id} limit 2`));
  if (result.length > 1) throw new Error("TEMPLATE_ROW_INCONSISTENT");
  return result[0] ? fromRow(result[0], businessId) : null;
}

export async function createBusinessTemplate(businessId: string, content: TemplateContent, extra: { starterKey?: string; product?: string } = {}) {
  requireStore();
  const business = await tenantId(businessId);
  const id = `tpl_${randomUUID().replace(/-/g, "")}`;
  const definition = definitionFor(content, { id, businessId, status: "draft", starterKey: extra.starterKey ?? null, vertical: extra.product ?? null });
  try {
    await postgresDb().execute(sql`insert into whatsapp_templates (messaging_business_id, legacy_template_id, name, language, category, status, body, variables, definition, created_at, updated_at)
      values (${business}, ${id}, ${content.name}, ${content.language}, ${content.category}, 'draft', ${content.body}, ${JSON.stringify({ examples: content.examples })}::jsonb, ${JSON.stringify(definition)}::jsonb, now(), now())`);
  } catch (error) {
    if (isNameConflict(error)) throw new TemplateNameTakenError();
    throw error;
  }
  return id;
}

/** Records an Authentication (sign-in code) template already submitted to Meta. The editor never
 * creates these: Meta fixes their wording, so only the name, language and Meta's id/status are kept. */
export async function createAuthenticationTemplate(businessId: string, input: { name: string; language: string; metaTemplateId: string; status: TemplateStatus }) {
  requireStore();
  const business = await tenantId(businessId);
  const id = `tpl_${randomUUID().replace(/-/g, "")}`;
  const body = "{{1}} is your verification code. For your security, do not share this code.";
  const definition = { name: input.name, language: input.language, category: "authentication", body, examples: ["123456"], buttons: [], header: "", footer: "", id, businessId, status: input.status, submittedAt: new Date().toISOString() };
  try {
    await postgresDb().execute(sql`insert into whatsapp_templates (messaging_business_id, legacy_template_id, name, language, category, status, body, meta_template_id, variables, definition, created_at, updated_at)
      values (${business}, ${id}, ${input.name}, ${input.language}, 'authentication', ${input.status}, ${body}, ${input.metaTemplateId}, ${JSON.stringify({ examples: ["123456"] })}::jsonb, ${JSON.stringify(definition)}::jsonb, now(), now())`);
  } catch (error) {
    if (isNameConflict(error)) throw new TemplateNameTakenError();
    throw error;
  }
  return id;
}

/** Updates content and/or lifecycle fields of one template owned by this business. */
export async function updateBusinessTemplate(
  businessId: string,
  id: string,
  change: { content?: TemplateContent; status?: TemplateStatus; metaTemplateId?: string | null; rejectionReason?: string | null; submittedAt?: string | null; category?: TemplateCategory },
) {
  requireStore();
  const current = await getBusinessTemplate(businessId, id);
  if (!current) throw new Error("TEMPLATE_NOT_FOUND");
  const business = await tenantId(businessId);
  const content = change.content ?? current;
  const status = change.status ?? current.status;
  const category = change.category ?? (change.content ? content.category : current.storedCategory === "unknown" ? content.category : current.storedCategory);
  const definition = definitionFor({ ...content, category: category === "marketing" ? "marketing" : "utility" }, {
    id, businessId, status,
    starterKey: current.starterKey,
    rejectionReason: change.rejectionReason === undefined ? current.rejectionReason : change.rejectionReason,
    submittedAt: change.submittedAt === undefined ? current.submittedAt : change.submittedAt,
  });
  const metaTemplateId = change.metaTemplateId === undefined ? current.metaTemplateId : change.metaTemplateId;
  try {
    await postgresDb().execute(sql`update whatsapp_templates set name = ${content.name}, language = ${content.language}, category = ${category}, status = ${status},
      body = ${content.body}, meta_template_id = ${metaTemplateId}, variables = ${JSON.stringify({ examples: content.examples })}::jsonb, definition = ${JSON.stringify(definition)}::jsonb, updated_at = now()
      where messaging_business_id = ${business} and legacy_template_id = ${id}`);
  } catch (error) {
    if (isNameConflict(error)) throw new TemplateNameTakenError();
    throw error;
  }
}

export async function deleteBusinessTemplate(businessId: string, id: string) {
  requireStore();
  const business = await tenantId(businessId);
  await postgresDb().execute(sql`delete from whatsapp_templates where messaging_business_id = ${business} and legacy_template_id = ${id} and status = 'draft' and meta_template_id is null`);
}
