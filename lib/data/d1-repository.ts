import type { BusinessRecord, D1Like, EntitlementRecord, MessagingRepository, SubscriptionEntitlementWrite, SubscriptionRecord, TenantRow, WhatsAppAccountRecord } from "./types";

const tenantTables = new Set(["whatsapp_accounts", "customers", "conversations", "messages", "message_delivery_events", "automations", "automation_events", "automation_runs", "templates", "campaigns", "dashboard_handoffs"]);
export class D1MessagingRepository implements MessagingRepository {
  constructor(private readonly db: D1Like) {}
  async getBusiness(id: string): Promise<BusinessRecord | null> {
    const row = await this.db.prepare("SELECT id, name, vertical, active, products_json, whatsapp_phone_number_id, data_json FROM businesses WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!row) return null;
    let products: string[] = [];
    try { products = Array.isArray(JSON.parse(String(row.products_json ?? "[]"))) ? JSON.parse(String(row.products_json ?? "[]")) : []; } catch { /* fail closed */ }
    let data: Record<string, unknown> = {}; try { const parsed = JSON.parse(String(row.data_json ?? "{}")); data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { /* fail closed */ }
    return { id: String(row.id), name: String(row.name), vertical: String(row.vertical), active: Number(row.active) === 1, products, whatsappPhoneNumberId: String(row.whatsapp_phone_number_id ?? ""), settings: data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings as Record<string, unknown> : {} };
  }
  async findActiveBusinessByPhoneNumberId(phoneNumberId: string): Promise<BusinessRecord | null> {
    const rows = (await this.db.prepare("SELECT id, name, vertical, active, products_json, whatsapp_phone_number_id, data_json FROM businesses WHERE whatsapp_phone_number_id = ? AND active = 1 LIMIT 2").bind(phoneNumberId).all<Record<string, unknown>>()).results;
    if (rows.length !== 1) return null;
    const row = rows[0];
    let products: string[] = []; try { const parsed = JSON.parse(String(row.products_json ?? "[]")); products = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { /* fail closed */ }
    let data: Record<string, unknown> = {}; try { const parsed = JSON.parse(String(row.data_json ?? "{}")); data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { /* fail closed */ }
    return { id: String(row.id), name: String(row.name), vertical: String(row.vertical), active: true, products, whatsappPhoneNumberId: String(row.whatsapp_phone_number_id ?? ""), settings: data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings as Record<string, unknown> : {} };
  }
  async getSubscriptionAndEntitlement(businessId: string) {
    const [subscription, entitlement] = await Promise.all([
      this.db.prepare("SELECT business_id, plan, status, started_at, expires_at FROM subscriptions WHERE business_id = ?").bind(businessId).first<Record<string, unknown>>(),
      this.db.prepare("SELECT business_id, whatsapp_automation, campaigns, advanced_analytics, ai_assistant FROM entitlements WHERE business_id = ?").bind(businessId).first<Record<string, unknown>>(),
    ]);
    return {
      subscription: subscription ? { businessId: String(subscription.business_id), plan: String(subscription.plan), status: String(subscription.status), startedAt: Number(subscription.started_at), expiresAt: Number(subscription.expires_at) } satisfies SubscriptionRecord : null,
      entitlement: entitlement ? { businessId: String(entitlement.business_id), whatsappAutomation: Number(entitlement.whatsapp_automation) === 1, campaigns: Number(entitlement.campaigns) === 1, advancedAnalytics: Number(entitlement.advanced_analytics) === 1, aiAssistant: Number(entitlement.ai_assistant) === 1 } satisfies EntitlementRecord : null,
    };
  }
  async writeSubscriptionEntitlement(input: SubscriptionEntitlementWrite) {
    const business = await this.db.prepare("SELECT id FROM businesses WHERE id = ?").bind(input.businessId).first();
    if (!business) throw new Error("Business not found.");
    const updatedAt = Date.now();
    await Promise.all([
      this.db.prepare("INSERT INTO subscriptions (business_id, plan, status, started_at, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(business_id) DO UPDATE SET plan=excluded.plan, status=excluded.status, started_at=excluded.started_at, expires_at=excluded.expires_at, updated_at=excluded.updated_at").bind(input.businessId, input.plan, input.status, input.startedAt, input.expiresAt, updatedAt).run(),
      this.db.prepare("INSERT INTO entitlements (business_id, whatsapp_automation, campaigns, advanced_analytics, ai_assistant, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(business_id) DO UPDATE SET whatsapp_automation=excluded.whatsapp_automation, campaigns=excluded.campaigns, advanced_analytics=excluded.advanced_analytics, ai_assistant=excluded.ai_assistant, updated_at=excluded.updated_at").bind(input.businessId, Number(input.whatsappAutomation), Number(input.campaigns), Number(input.advancedAnalytics), Number(input.aiAssistant), updatedAt).run(),
    ]);
  }
  private parseTenantRow(row: Record<string, unknown>): TenantRow {
    let data: Record<string, unknown> = {}; try { const parsed = JSON.parse(String(row.data_json ?? "{}")); data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { /* fail closed */ }
    return { ...data, id: String(row.id), businessId: String(row.business_id) };
  }
  async getWhatsAppAccount(businessId: string): Promise<WhatsAppAccountRecord | null> {
    const row = await this.db.prepare("SELECT id, business_id, phone_number_id, status, data_json FROM whatsapp_accounts WHERE id = ? AND business_id = ?").bind(businessId, businessId).first<Record<string, unknown>>();
    if (!row) return null; const data = this.parseTenantRow(row);
    return { ...data, phoneNumberId: String(row.phone_number_id ?? ""), status: String(row.status ?? ""), wabaId: typeof data.wabaId === "string" ? data.wabaId : undefined, displayPhone: typeof data.displayPhone === "string" ? data.displayPhone : undefined, tokenSecretName: typeof data.tokenSecretName === "string" ? data.tokenSecretName : undefined };
  }
  async findWhatsAppAccountByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccountRecord | null> {
    const rows = (await this.db.prepare("SELECT id, business_id, phone_number_id, status, data_json FROM whatsapp_accounts WHERE phone_number_id = ? LIMIT 2").bind(phoneNumberId).all<Record<string, unknown>>()).results;
    if (rows.length !== 1) return null; const row = rows[0]; const data = this.parseTenantRow(row);
    return { ...data, phoneNumberId: String(row.phone_number_id ?? ""), status: String(row.status ?? ""), wabaId: typeof data.wabaId === "string" ? data.wabaId : undefined, displayPhone: typeof data.displayPhone === "string" ? data.displayPhone : undefined, tokenSecretName: typeof data.tokenSecretName === "string" ? data.tokenSecretName : undefined };
  }
  async getTenantRow(table: string, businessId: string, id: string) {
    if (!tenantTables.has(table)) throw new Error("Unsupported tenant table.");
    const row = await this.db.prepare(`SELECT id, business_id, data_json FROM ${table} WHERE id = ? AND business_id = ?`).bind(id, businessId).first<Record<string, unknown>>();
    return row ? this.parseTenantRow(row) : null;
  }
  async listTenantRows(table: string, businessId: string) {
    if (!tenantTables.has(table)) throw new Error("Unsupported tenant table.");
    const result = await this.db.prepare(`SELECT id, business_id, data_json FROM ${table} WHERE business_id = ?`).bind(businessId).all<Record<string, unknown>>();
    return result.results.map(row => this.parseTenantRow(row));
  }
  async updateMessageState(businessId: string, id: string, update: Record<string, unknown>) {
    const current = await this.getTenantRow("messages", businessId, id); if (!current) throw new Error("Message not found.");
    const row = { ...current, ...update }; await this.db.prepare("UPDATE messages SET data_json = ?, updated_at = ? WHERE id = ? AND business_id = ?").bind(JSON.stringify(row), Date.now(), id, businessId).run(); return row;
  }
  async hasOutgoingReply(businessId: string, incomingMessageId: string) { const row = await this.db.prepare("SELECT id FROM messages WHERE business_id = ? AND data_json LIKE ? LIMIT 1").bind(businessId, `%\"incomingMessageId\":\"${incomingMessageId.replaceAll('"', '')}\"%`).first(); return !!row; }
  async storeOutgoingReply(row: TenantRow & { incomingMessageId: string }) { await this.upsertTenantRow("messages", row); }
  async storeDeliveryEvent(row: TenantRow & { messageId: string; status: string }) { await this.upsertTenantRow("message_delivery_events", row); }
  async reservePhoneMapping(businessId: string, phoneNumberId: string) {
    const existing = await this.db.prepare("SELECT business_id FROM whatsapp_phone_mappings WHERE phone_number_id = ?").bind(phoneNumberId).first<{ business_id: string }>();
    if (existing) { if (existing.business_id !== businessId) throw new Error("PHONE_ALREADY_CONNECTED"); return; }
    try { await this.db.prepare("INSERT INTO whatsapp_phone_mappings (phone_number_id, business_id, account_id, updated_at) VALUES (?, ?, ?, ?)").bind(phoneNumberId, businessId, businessId, Date.now()).run(); }
    catch { const winner = await this.db.prepare("SELECT business_id FROM whatsapp_phone_mappings WHERE phone_number_id = ?").bind(phoneNumberId).first<{ business_id: string }>(); if (!winner || winner.business_id !== businessId) throw new Error("PHONE_ALREADY_CONNECTED"); }
  }
  async compareAndSwapWhatsAppSetup(businessId: string, expectedRevision: number, update: TenantRow) {
    const current = await this.db.prepare("SELECT id, business_id, revision, data_json FROM whatsapp_accounts WHERE id = ? AND business_id = ?").bind(businessId, businessId).first<{ id: string; business_id: string; revision: number; data_json: string }>();
    if (!current || Number(current.revision) !== expectedRevision) throw new Error("STALE_SETUP_REVISION");
    const revision = expectedRevision + 1; const data = JSON.stringify({ ...JSON.parse(current.data_json), ...update, revision });
    await this.db.prepare("UPDATE whatsapp_accounts SET data_json = ?, revision = ?, updated_at = ? WHERE id = ? AND business_id = ? AND revision = ?").bind(data, revision, Date.now(), businessId, businessId, expectedRevision).run();
    return revision;
  }
  async upsertTenantRow(table: string, row: TenantRow) {
    if (!tenantTables.has(table)) throw new Error("Unsupported tenant table.");
    const now = Date.now(); const data = JSON.stringify(row);
    if (table === "whatsapp_accounts") {
      const phoneNumberId = typeof row.phoneNumberId === "string" ? row.phoneNumberId : null;
      const status = typeof row.status === "string" ? row.status : "draft";
      await this.db.prepare("INSERT INTO whatsapp_accounts (id, business_id, phone_number_id, status, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET business_id=excluded.business_id, phone_number_id=excluded.phone_number_id, status=excluded.status, data_json=excluded.data_json, updated_at=excluded.updated_at").bind(row.id, row.businessId, phoneNumberId, status, data, now).run();
      return;
    }
    if (table === "automations") {
      if (typeof row.product !== "string") throw new Error("Automation product is required.");
      const status = typeof row.status === "string" ? row.status : "draft";
      await this.db.prepare("INSERT INTO automations (id, business_id, product, status, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET business_id=excluded.business_id, product=excluded.product, status=excluded.status, data_json=excluded.data_json, updated_at=excluded.updated_at").bind(row.id, row.businessId, row.product, status, data, now).run();
      return;
    }
    if (table === "automation_events" || table === "automation_runs") {
      const status = typeof row.status === "string" ? row.status : "queued";
      await this.db.prepare(`INSERT INTO ${table} (id, business_id, status, data_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET business_id=excluded.business_id, status=excluded.status, data_json=excluded.data_json, updated_at=excluded.updated_at`).bind(row.id, row.businessId, status, data, now).run();
      return;
    }
    await this.db.prepare(`INSERT INTO ${table} (id, business_id, data_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET business_id=excluded.business_id, data_json=excluded.data_json, updated_at=excluded.updated_at`).bind(row.id, row.businessId, data, now).run();
  }
}
