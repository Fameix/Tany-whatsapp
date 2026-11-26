import "server-only";
import { sql } from "drizzle-orm";
import type { BusinessRecord, EntitlementRecord, SubscriptionEntitlementWrite, SubscriptionRecord, TenantRow, WhatsAppAccountRecord } from "./types";
import { localMessagingBusinessId } from "./postgres-business-map";
import { postgresDb, postgresTransactionPool } from "./postgres-client";
import { decryptPostgresContactPhone, postgresContactProjection } from "./postgres-contact-privacy";

type DbRow = Record<string, unknown>;
const rows = async (query: ReturnType<ReturnType<typeof postgresDb>["execute"]>) => (await query as unknown as { rows?: DbRow[] }).rows ?? [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const asDate = (value: unknown) => value instanceof Date ? value : typeof value === "number" ? new Date(value) : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
const runtimeCollections = new Set(["customers", "orders", "payments", "bookings", "cart_events", "conversations", "messages", "whatsappOperations", "automation_context", "campaigns", "message_delivery_events"]);
const runtimeJson = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(runtimeJson);
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") return candidate.toDate().toISOString();
    return Object.fromEntries(Object.entries(value as DbRow).map(([key, child]) => [key, runtimeJson(child)]));
  }
  return value;
};

/** Firestore-compatible adapter for the standalone Messaging Neon schema.
 * Legacy Firestore IDs resolve only through messaging_businesses. */
export class PostgresMessagingRepository {
  async getRuntimeRecord(collection: string, businessId: string, id: string): Promise<TenantRow | null> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select legacy_id, data from messaging_runtime_records where messaging_business_id=${business.id} and collection=${collection} and legacy_id=${id} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_RUNTIME_RECORD_INCONSISTENT");
    const data = result[0]?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? { ...(data as TenantRow), id, businessId } : null;
  }
  async getRuntimeRecordById(collection: string, id: string): Promise<TenantRow | null> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const result = await rows(postgresDb().execute(sql`select b.legacy_business_id, r.data from messaging_runtime_records r join messaging_businesses b on b.id=r.messaging_business_id where r.collection=${collection} and r.legacy_id=${id} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_RUNTIME_RECORD_AMBIGUOUS");
    const data = result[0]?.data;
    return data && typeof data === "object" && !Array.isArray(data) ? { ...(data as TenantRow), id, businessId: text(result[0].legacy_business_id) } : null;
  }
  async listRuntimeRecords(collection: string, businessId: string): Promise<TenantRow[]> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select legacy_id, data from messaging_runtime_records where messaging_business_id=${business.id} and collection=${collection} order by created_at`));
    return result.flatMap(row => row.data && typeof row.data === "object" && !Array.isArray(row.data) ? [{ ...(row.data as TenantRow), id: text(row.legacy_id), businessId }] : []);
  }
  async putRuntimeRecord(collection: string, row: TenantRow): Promise<void> {
    if (!runtimeCollections.has(collection) || !row.id || !row.businessId) throw new Error("POSTGRES_RUNTIME_RECORD_INVALID");
    const business = await this.businessRow(row.businessId);
    await postgresDb().execute(sql`insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data,updated_at) values(${business.id},${collection},${row.id},${JSON.stringify(safePayload(runtimeJson(row)))}::jsonb,now()) on conflict(messaging_business_id,collection,legacy_id) do update set data=excluded.data,updated_at=now()`);
  }
  async mutateRuntimeRecord<T extends TenantRow>(collection: string, businessId: string, id: string, mutate: (current: T | null) => T | Promise<T>): Promise<T> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const business = await this.businessRow(businessId);
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const found = (await client.query("select data from messaging_runtime_records where messaging_business_id=$1 and collection=$2 and legacy_id=$3 for update", [business.id, collection, id])).rows as DbRow[];
      const raw = found[0]?.data;
      const current = raw && typeof raw === "object" ? { ...(raw as T), id, businessId } : null;
      const next = await mutate(current);
      await client.query("insert into messaging_runtime_records(messaging_business_id,collection,legacy_id,data,updated_at) values($1,$2,$3,$4::jsonb,now()) on conflict(messaging_business_id,collection,legacy_id) do update set data=excluded.data,updated_at=now()", [business.id, collection, id, JSON.stringify(safePayload(runtimeJson(next)))]);
      await client.query("commit");
      return next;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async mutateRuntimeRecordById<T extends TenantRow>(collection: string, id: string, mutate: (current: T) => T | Promise<T>): Promise<{ previous: T; current: T }> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const found = (await client.query("select r.messaging_business_id,b.legacy_business_id,r.data from messaging_runtime_records r join messaging_businesses b on b.id=r.messaging_business_id where r.collection=$1 and r.legacy_id=$2 for update of r", [collection, id])).rows as DbRow[];
      if (found.length !== 1) throw new Error(found.length ? "POSTGRES_RUNTIME_RECORD_AMBIGUOUS" : "Document not found");
      const raw = found[0].data as T;
      const businessId = text(found[0].legacy_business_id);
      const previous = { ...raw, id, businessId };
      const current = await mutate(previous);
      await client.query("update messaging_runtime_records set data=$1::jsonb,updated_at=now() where messaging_business_id=$2 and collection=$3 and legacy_id=$4", [JSON.stringify(safePayload(runtimeJson(current))), found[0].messaging_business_id, collection, id]);
      await client.query("commit");
      return { previous, current };
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async deleteRuntimeRecord(collection: string, businessId: string, id: string): Promise<void> {
    if (!runtimeCollections.has(collection)) throw new Error("POSTGRES_RUNTIME_COLLECTION_UNSUPPORTED");
    const business = await this.businessRow(businessId);
    await postgresDb().execute(sql`delete from messaging_runtime_records where messaging_business_id=${business.id} and collection=${collection} and legacy_id=${id}`);
  }
  async identity(phone: string) {
    const r = await rows(postgresDb().execute(sql`select phone, uid, linked, linked_at, last_seen_at from whatsapp_identities where phone=${phone} limit 2`));
    if (r.length > 1) throw new Error("POSTGRES_IDENTITY_INCONSISTENT");
    return r[0] ?? null;
  }
  async getSubscriptionAndEntitlement(businessId: string): Promise<{ subscription: SubscriptionRecord | null; entitlement: EntitlementRecord | null }> {
    await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select legacy_business_id, plan, status, started_at, expires_at, whatsapp_automation, campaigns, advanced_analytics, ai_assistant from messaging_subscriptions where legacy_business_id=${businessId} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_SUBSCRIPTION_INCONSISTENT");
    const row = result[0];
    if (!row) return { subscription: null, entitlement: null };
    const startedAt = asDate(row.started_at), expiresAt = asDate(row.expires_at);
    if (!startedAt || !expiresAt) throw new Error("POSTGRES_SUBSCRIPTION_INVALID_DATES");
    return {
      subscription: { businessId, plan: text(row.plan), status: text(row.status), startedAt: startedAt.getTime(), expiresAt: expiresAt.getTime() },
      entitlement: { businessId, whatsappAutomation: row.whatsapp_automation === true, campaigns: row.campaigns === true, advancedAnalytics: row.advanced_analytics === true, aiAssistant: row.ai_assistant === true },
    };
  }
  async writeSubscriptionEntitlement(input: SubscriptionEntitlementWrite): Promise<void> {
    await this.businessRow(input.businessId);
    await postgresDb().execute(sql`insert into messaging_subscriptions(legacy_business_id,plan,status,started_at,expires_at,whatsapp_automation,campaigns,advanced_analytics,ai_assistant,updated_at)
      values(${input.businessId},${input.plan},${input.status},${new Date(input.startedAt)},${new Date(input.expiresAt)},${input.whatsappAutomation},${input.campaigns},${input.advancedAnalytics},${input.aiAssistant},now())
      on conflict(legacy_business_id) do update set plan=excluded.plan,status=excluded.status,started_at=excluded.started_at,expires_at=excluded.expires_at,whatsapp_automation=excluded.whatsapp_automation,campaigns=excluded.campaigns,advanced_analytics=excluded.advanced_analytics,ai_assistant=excluded.ai_assistant,updated_at=now()`);
  }
  async createOrReuseLinkSession(input: { token: string; phone: string; businessId: string; expiresAt: Date; pendingIntent: string | null }) {
    await this.businessRow(input.businessId);
    const existing = await rows(postgresDb().execute(sql`select token from whatsapp_link_sessions where whatsapp_phone=${input.phone} and legacy_business_id=${input.businessId} and used=false and expires_at>now() and token ~ '^[a-f0-9]{64}$' order by created_at limit 1`));
    if (existing[0]) return text(existing[0].token);
    const r = await rows(postgresDb().execute(sql`insert into whatsapp_link_sessions(token,whatsapp_phone,legacy_business_id,expires_at,used,pending_intent) values(${input.token},${input.phone},${input.businessId},${input.expiresAt},false,${input.pendingIntent}) on conflict(token) do nothing returning token`));
    if (!r[0]) throw new Error("POSTGRES_LINK_SESSION_CREATE_FAILED");
    return text(r[0].token);
  }
  async getLinkSession(token: string) { const r = await rows(postgresDb().execute(sql`select token, whatsapp_phone, legacy_business_id, expires_at, used, pending_intent, notification_status, created_at, used_at from whatsapp_link_sessions where token=${token} limit 2`)); if (r.length > 1) throw new Error("POSTGRES_LINK_SESSION_INCONSISTENT"); return r[0] ?? null; }
  async claimLinkNotification(token: string, businessId: string, phone: string) { await this.businessRow(businessId); const r=await rows(postgresDb().execute(sql`update whatsapp_link_sessions set notification_status='sending',updated_at=now() where token=${token} and legacy_business_id=${businessId} and whatsapp_phone=${phone} and used=true and notification_status='pending' returning token`)); return !!r[0]; }
  async finishLinkNotification(token: string, businessId: string, phone: string, status: "sent"|"failed") { await postgresDb().execute(sql`update whatsapp_link_sessions set notification_status=${status},updated_at=now() where token=${token} and legacy_business_id=${businessId} and whatsapp_phone=${phone} and used=true and notification_status='sending'`); }
  async completeLinkSession(token: string, uid: string) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const r = (await client.query("select s.token,s.whatsapp_phone,s.legacy_business_id,s.pending_intent from whatsapp_link_sessions s join messaging_businesses b on b.legacy_business_id=s.legacy_business_id and b.status='active' where s.token=$1 and s.used=false and s.expires_at>now() for update of s",[token])).rows as DbRow[];
      if (!r[0]) { await client.query("rollback"); return null; }
      const s=r[0]; const businessId=text(s.legacy_business_id), phone=text(s.whatsapp_phone);
      const id=(await client.query("select uid from whatsapp_identities where phone=$1 for update",[phone])).rows as DbRow[];
      const link=(await client.query("select uid from whatsapp_customer_links where legacy_business_id=$1 and whatsapp_phone=$2 for update",[businessId,phone])).rows as DbRow[];
      if ((id[0] && text(id[0].uid)!==uid)||(link[0]&&text(link[0].uid)!==uid)) throw new Error("POSTGRES_LINK_CONFLICT");
      await client.query("insert into whatsapp_identities(phone,uid,linked,linked_at,last_seen_at) values($1,$2,true,now(),now()) on conflict(phone) do update set uid=excluded.uid,linked=true,last_seen_at=now()",[phone,uid]);
      await client.query("insert into whatsapp_customer_links(legacy_business_id,whatsapp_phone,uid,linked,pending_intent,linked_at,last_interaction_at,updated_at) values($1,$2,$3,true,$4,now(),now(),now()) on conflict(legacy_business_id,whatsapp_phone) do update set uid=excluded.uid,linked=true,pending_intent=coalesce(excluded.pending_intent,whatsapp_customer_links.pending_intent),last_interaction_at=now(),updated_at=now()",[businessId,phone,uid,s.pending_intent]);
      const consumed=(await client.query("update whatsapp_link_sessions set used=true,used_at=now(),notification_status='pending',updated_at=now() where token=$1 and used=false returning token",[token])).rows as DbRow[];
      if (!consumed[0]) { await client.query("rollback"); return null; }
      await client.query("commit");
      return { businessId, whatsappPhone:phone };
    } catch(error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async touchCustomer(businessId:string,phone:string,uid:string) { await this.businessRow(businessId); await postgresDb().execute(sql`insert into whatsapp_customer_links(legacy_business_id,whatsapp_phone,uid,linked,linked_at,last_interaction_at,updated_at) values(${businessId},${phone},${uid},true,now(),now(),now()) on conflict(legacy_business_id,whatsapp_phone) do update set last_interaction_at=now(),updated_at=now() where whatsapp_customer_links.uid=excluded.uid`); await postgresDb().execute(sql`update whatsapp_identities set last_seen_at=now() where phone=${phone} and uid=${uid} and linked=true`); }
  async pendingIntent(businessId:string,phone:string) { await this.businessRow(businessId); const r=await rows(postgresDb().execute(sql`select pending_intent from whatsapp_customer_links where legacy_business_id=${businessId} and whatsapp_phone=${phone} and linked=true limit 2`)); return text(r[0]?.pending_intent)||null; }
  async clearPendingIntent(businessId:string,phone:string,expected:string) { await this.businessRow(businessId); await postgresDb().execute(sql`update whatsapp_customer_links set pending_intent=null,updated_at=now() where legacy_business_id=${businessId} and whatsapp_phone=${phone} and pending_intent=${expected}`); }
  private async businessRow(businessId: string) {
    const result = await rows(postgresDb().execute(sql`select * from messaging_businesses where legacy_business_id = ${businessId} limit 1`));
    const row = result[0];
    const id = localMessagingBusinessId(businessId, row as { id: unknown; legacy_business_id: unknown } | undefined);
    if (!id) throw new Error("POSTGRES_TENANT_UNMAPPED");
    return { id, row: row! };
  }

  async getBusiness(businessId: string): Promise<BusinessRecord | null> {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select coalesce(a.phone_number_id,b.whatsapp_phone_number_id,'') as phone_number_id from messaging_businesses b left join whatsapp_accounts a on a.messaging_business_id=b.id where b.id=${business.id} limit 1`));
    return { id: businessId, name: text(business.row.name), vertical: text(business.row.vertical), active: text(business.row.status) === "active", products: Array.isArray(business.row.products) ? business.row.products.filter((v): v is string => typeof v === "string") : [], whatsappPhoneNumberId: text(result[0]?.phone_number_id), settings: business.row.settings && typeof business.row.settings === "object" && !Array.isArray(business.row.settings) ? business.row.settings as Record<string, unknown> : {} };
  }

  async getWhatsAppAccount(businessId: string): Promise<WhatsAppAccountRecord | null> {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select * from whatsapp_accounts where messaging_business_id = ${business.id} limit 1`));
    return result[0] ? { ...account(result[0], businessId), id: businessId } : null;
  }

  async saveWhatsAppSetup(input: { businessId: string; vertical: string; setupType: string; displayName: string; displayPhone: string; businessName: string; phoneNumberId: string; wabaId: string; tokenSecretName: string }) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const tenants = (await client.query("select id,status from messaging_businesses where legacy_business_id=$1 for update", [input.businessId])).rows as DbRow[];
      if (!tenants[0]) throw new Error("POSTGRES_TENANT_UNMAPPED");
      if (text(tenants[0].status) !== "active") throw new Error("POSTGRES_BUSINESS_INACTIVE");
      const current = (await client.query("select id,status,phone_number_id,revision,catalog_id,catalog_enabled,test_passed,validation_mode from whatsapp_accounts where messaging_business_id=$1 for update", [tenants[0].id])).rows as DbRow[];
      const old = current[0];
      const verifiedLive = old?.test_passed === true && text(old.validation_mode) === "live";
      if (old && (text(old.status) === "testing" || (text(old.status) === "connected" && verifiedLive))) throw new Error("WHATSAPP_ACCOUNT_BUSY");
      const phoneNumberId = input.phoneNumberId || null;
      if (phoneNumberId) {
        const duplicates = (await client.query("select messaging_business_id from whatsapp_accounts where phone_number_id=$1 and messaging_business_id<>$2 limit 1", [phoneNumberId, tenants[0].id])).rows;
        if (duplicates.length) throw new Error("POSTGRES_PHONE_ALREADY_CONNECTED");
        const mapped = (await client.query("select messaging_business_id from whatsapp_phone_mappings where phone_number_id=$1 for update", [phoneNumberId])).rows;
        if (mapped[0] && text(mapped[0].messaging_business_id) !== text(tenants[0].id)) throw new Error("POSTGRES_PHONE_ALREADY_CONNECTED");
      }
      if (old?.phone_number_id && old.phone_number_id !== phoneNumberId) await client.query("delete from whatsapp_phone_mappings where phone_number_id=$1 and messaging_business_id=$2", [old.phone_number_id, tenants[0].id]);
      const saved = (await client.query(`insert into whatsapp_accounts(messaging_business_id,product,waba_id,phone_number_id,display_phone,display_name,token_secret_name,status,test_passed,validation_mode,test_message,tested_at,setup_type,business_name,setup_step,revision,catalog_id,catalog_enabled,test_status,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,'pending',false,null,'',null,$8,$9,3,$10,coalesce($11,''),coalesce($12,false),'unverified',now())
        on conflict(messaging_business_id) do update set product=excluded.product,waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,display_phone=excluded.display_phone,display_name=excluded.display_name,token_secret_name=excluded.token_secret_name,status='pending',test_passed=false,validation_mode=null,test_message='',tested_at=null,setup_type=excluded.setup_type,business_name=excluded.business_name,setup_step=3,revision=excluded.revision,updated_at=now()
        returning id`, [tenants[0].id,input.vertical,input.wabaId||null,phoneNumberId,input.displayPhone,input.displayName,input.tokenSecretName,input.setupType,input.businessName,Number(old?.revision||0)+1,old?.catalog_id,old?.catalog_enabled])).rows as DbRow[];
      if (phoneNumberId) await client.query("insert into whatsapp_phone_mappings(phone_number_id,messaging_business_id,whatsapp_account_id,updated_at) values($1,$2,$3,now()) on conflict(phone_number_id) do update set whatsapp_account_id=excluded.whatsapp_account_id,updated_at=now()", [phoneNumberId,tenants[0].id,saved[0].id]);
      await client.query("update messaging_businesses set whatsapp_phone_number_id=$2,updated_at=now() where id=$1", [tenants[0].id,phoneNumberId||""]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async updateAccountMetadata(input: { businessId: string; accountId: string; displayName: string; displayPhone: string; phoneNumberId: string; wabaId: string; tokenSecretName: string; status: string; activateForTesting: boolean }) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const businesses = (await client.query("select id,vertical,status,whatsapp_phone_number_id from messaging_businesses where legacy_business_id=$1 for update", [input.businessId])).rows as DbRow[];
      if (!businesses[0]) throw new Error("POSTGRES_TENANT_UNMAPPED");
      const business = businesses[0];
      const accounts = (await client.query("select * from whatsapp_accounts where messaging_business_id=$1 for update", [business.id])).rows as DbRow[];
      const prior = accounts[0] ?? { phone_number_id: business.whatsapp_phone_number_id, revision: 0 };
      if (accounts[0] && input.accountId !== input.businessId) throw new Error("POSTGRES_ACCOUNT_NOT_FOUND");
      if (!accounts[0] && (input.accountId !== input.businessId || !text(business.whatsapp_phone_number_id))) throw new Error("POSTGRES_ACCOUNT_NOT_FOUND");
      const occupied = (await client.query("select messaging_business_id from whatsapp_accounts where phone_number_id=$1 and messaging_business_id<>$2 limit 1", [input.phoneNumberId, business.id])).rows;
      const mapping = (await client.query("select messaging_business_id from whatsapp_phone_mappings where phone_number_id=$1 for update", [input.phoneNumberId])).rows;
      if (occupied.length || (mapping[0] && text(mapping[0].messaging_business_id) !== text(business.id))) throw new Error("POSTGRES_PHONE_ALREADY_CONNECTED");
      if (input.activateForTesting && text(business.status) !== "active") throw new Error("POSTGRES_BUSINESS_INACTIVE");
      const changed = text(prior.phone_number_id) !== input.phoneNumberId || text(prior.waba_id) !== input.wabaId || text(prior.display_phone).replace(/[\s()+-]/g, "") !== input.displayPhone.replace(/[\s()+-]/g, "");
      const verified = !changed && prior.test_passed === true && text(prior.validation_mode) === "live" && !!prior.tested_at;
      const status = input.activateForTesting ? "connected" : input.status === "connected" && !verified ? "pending" : input.status;
      const keepVerification = verified && status === "connected";
      const oldPhone = text(prior.phone_number_id);
      const saved = (await client.query(`insert into whatsapp_accounts(messaging_business_id,product,waba_id,phone_number_id,display_phone,display_name,token_secret_name,status,test_passed,validation_mode,test_message,tested_at,setup_type,business_name,setup_step,revision,internal_testing_active,activated_at,test_status,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'existing','',${keepVerification ? 5 : input.activateForTesting ? 5 : 3},$13,$14,$15,$16,now())
        on conflict(messaging_business_id) do update set waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,display_phone=excluded.display_phone,display_name=excluded.display_name,token_secret_name=excluded.token_secret_name,status=excluded.status,test_passed=excluded.test_passed,validation_mode=excluded.validation_mode,test_message=excluded.test_message,tested_at=excluded.tested_at,setup_type='existing',setup_step=excluded.setup_step,revision=excluded.revision,internal_testing_active=excluded.internal_testing_active,activated_at=excluded.activated_at,test_status=excluded.test_status,updated_at=now() returning id`, [business.id,text(business.vertical),input.wabaId,input.phoneNumberId,input.displayPhone,input.displayName,input.tokenSecretName,status,keepVerification,keepVerification ? prior.validation_mode : null,keepVerification ? prior.test_message : "",keepVerification ? prior.tested_at : null,Number(prior.revision||0)+1,input.activateForTesting,input.activateForTesting ? new Date() : null,input.activateForTesting ? "internal_manual" : keepVerification ? "success" : "unverified"])).rows as DbRow[];
      if (oldPhone && oldPhone !== input.phoneNumberId) await client.query("delete from whatsapp_phone_mappings where phone_number_id=$1 and messaging_business_id=$2", [oldPhone,business.id]);
      await client.query("insert into whatsapp_phone_mappings(phone_number_id,messaging_business_id,whatsapp_account_id,updated_at) values($1,$2,$3,now()) on conflict(phone_number_id) do update set whatsapp_account_id=excluded.whatsapp_account_id,updated_at=now()", [input.phoneNumberId,business.id,saved[0].id]);
      await client.query("update messaging_businesses set whatsapp_phone_number_id=$2,updated_at=now() where id=$1", [business.id,input.phoneNumberId]);
      await client.query("commit");
      return { status, message: input.activateForTesting ? "Activated for internal testing. Live Meta connectivity remains unverified." : status === "pending" ? "Account saved. Configured / unverified; no live verification was performed." : "Account metadata saved." };
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async claimWhatsAppSetupTest(businessId: string) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const result = (await client.query("select a.* from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id where b.legacy_business_id=$1 and b.status='active' for update of a", [businessId])).rows as DbRow[];
      const row = result[0];
      if (!row) throw new Error("WHATSAPP_ACCOUNT_NOT_FOUND");
      if (text(row.setup_type) !== "existing") throw new Error("WHATSAPP_SETUP_ASSISTANCE_REQUIRED");
      if (["testing","connected"].includes(text(row.status))) throw new Error("WHATSAPP_ACCOUNT_BUSY");
      const changed = (await client.query("update whatsapp_accounts set status='testing',setup_step=4,test_passed=false,updated_at=now() where id=$1 returning *", [row.id])).rows as DbRow[];
      await client.query("commit");
      return account(changed[0],businessId);
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async finishWhatsAppSetupTest(businessId: string, revision: number, success: boolean, message: string, mode: string | null) {
    const result = await rows(postgresDb().execute(sql`update whatsapp_accounts a set status=${success ? "pending" : "error"},setup_step=${success ? 5 : 4},test_passed=${success},test_message=${message},validation_mode=${success ? mode : null},tested_at=${success ? new Date() : null},updated_at=now() from messaging_businesses b where a.messaging_business_id=b.id and b.legacy_business_id=${businessId} and a.revision=${revision} and a.status='testing' returning a.id`));
    if (!result[0]) throw new Error("WHATSAPP_SETUP_STALE_TEST");
  }
  async activateWhatsAppSetup(businessId: string) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const result = (await client.query("select a.id,a.phone_number_id,b.id as business_uuid from whatsapp_accounts a join messaging_businesses b on b.id=a.messaging_business_id where b.legacy_business_id=$1 and b.status='active' and a.status='pending' and a.test_passed=true for update of a,b", [businessId])).rows as DbRow[];
      if (!result[0]) throw new Error("WHATSAPP_SETUP_TEST_REQUIRED");
      await client.query("update whatsapp_accounts set status='connected',setup_step=5,updated_at=now() where id=$1", [result[0].id]);
      await client.query("update messaging_businesses set whatsapp_phone_number_id=$2,updated_at=now() where id=$1", [result[0].business_uuid,text(result[0].phone_number_id)]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async disconnectWhatsAppSetup(businessId: string) {
    const client = await postgresTransactionPool().connect();
    try {
      await client.query("begin");
      const businesses = (await client.query("select id,whatsapp_phone_number_id from messaging_businesses where legacy_business_id=$1 for update", [businessId])).rows as DbRow[];
      const business = businesses[0];
      if (!business) throw new Error("POSTGRES_TENANT_UNMAPPED");
      const accounts = (await client.query("select id,phone_number_id from whatsapp_accounts where messaging_business_id=$1 for update", [business.id])).rows as DbRow[];
      const account = accounts[0];
      if (!account) throw new Error("WHATSAPP_ACCOUNT_NOT_FOUND");
      const phoneNumberId = text(account.phone_number_id);
      if (phoneNumberId) {
        const mappings = (await client.query("select messaging_business_id from whatsapp_phone_mappings where phone_number_id=$1 for update", [phoneNumberId])).rows as DbRow[];
        if (mappings[0] && text(mappings[0].messaging_business_id) !== text(business.id)) throw new Error("POSTGRES_PHONE_MAPPING_TENANT_MISMATCH");
        await client.query("delete from whatsapp_phone_mappings where phone_number_id=$1 and messaging_business_id=$2", [phoneNumberId, business.id]);
      }
      await client.query("delete from whatsapp_phone_mappings where whatsapp_account_id=$1 and messaging_business_id=$2", [account.id, business.id]);
      await client.query("update whatsapp_accounts set status='disconnected',waba_id=null,phone_number_id=null,display_phone=null,display_name=null,token_secret_name='',setup_step=1,revision=revision+1,updated_at=now() where id=$1", [account.id]);
      await client.query("update messaging_businesses set whatsapp_phone_number_id=null,updated_at=now() where id=$1", [business.id]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async findActiveBusinessByPhoneNumberId(phoneNumberId: string): Promise<BusinessRecord | null> {
    const result = await rows(postgresDb().execute(sql`select b.* from messaging_businesses b left join whatsapp_phone_mappings p on p.messaging_business_id=b.id where (b.whatsapp_phone_number_id=${phoneNumberId} or p.phone_number_id=${phoneNumberId}) and b.status='active' limit 2`));
    if (result.length !== 1) return null;
    const row = result[0];
    return { id: text(row.legacy_business_id), name: text(row.name), vertical: text(row.vertical), active: true, products: Array.isArray(row.products) ? row.products.filter((v): v is string => typeof v === "string") : [], whatsappPhoneNumberId: phoneNumberId, settings: row.settings && typeof row.settings === "object" && !Array.isArray(row.settings) ? row.settings as Record<string, unknown> : {} };
  }

  async findWhatsAppAccountByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccountRecord | null> {
    const result = await rows(postgresDb().execute(sql`select a.*, b.legacy_business_id from whatsapp_accounts a join messaging_businesses b on b.id = a.messaging_business_id where a.phone_number_id = ${phoneNumberId} limit 2`));
    if (result.length !== 1) return null;
    return account(result[0], text(result[0].legacy_business_id));
  }

  async listCatalog(businessId: string, filters: { available?: boolean; type?: string; category?: string; maxPrice?: number } = {}) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select id,type,name,description,price,available,category,metadata,created_at,updated_at from messaging_catalog_items where messaging_business_id=${business.id}
      and (${filters.available === undefined} or available=${filters.available ?? false})
      and (${!filters.type} or type=${filters.type ?? ""}) and (${!filters.category} or category=${filters.category ?? ""})
      and (${filters.maxPrice === undefined} or price<=${filters.maxPrice ?? 0}) order by coalesce((metadata->>'sortOrder')::numeric,0),id`));
    return result.map(catalogItem);
  }
  async getCatalogItem(businessId: string, itemId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select id,type,name,description,price,available,category,metadata,created_at,updated_at from messaging_catalog_items where messaging_business_id=${business.id} and id=${itemId} limit 1`));
    return result[0] ? catalogItem(result[0]) : null;
  }
  async saveCatalogItem(businessId: string, itemId: string, input: { type: string; name: string; description: string; price: number; available: boolean; category: string | null; metadata: Record<string, unknown> }) {
    const business = await this.businessRow(businessId);
    await postgresDb().execute(sql`insert into messaging_catalog_items(messaging_business_id,id,type,name,description,price,available,category,metadata,updated_at)
      values(${business.id},${itemId},${input.type},${input.name},${input.description},${input.price},${input.available},${input.category},${JSON.stringify(input.metadata)}::jsonb,now())
      on conflict(messaging_business_id,id) do update set type=excluded.type,name=excluded.name,description=excluded.description,price=excluded.price,available=excluded.available,category=excluded.category,metadata=excluded.metadata,updated_at=now()`);
  }
  async deleteCatalogItem(businessId: string, itemId: string) {
    const business = await this.businessRow(businessId);
    await postgresDb().execute(sql`delete from messaging_catalog_items where messaging_business_id=${business.id} and id=${itemId}`);
    await postgresDb().execute(sql`delete from whatsapp_catalog_product_mappings where messaging_business_id=${business.id} and tany_product_id=${itemId}`);
  }
  async catalogMappings(businessId: string) {
    const business = await this.businessRow(businessId);
    return await rows(postgresDb().execute(sql`select tany_product_id,retailer_product_id,catalog_id,whatsapp_review_status,whatsapp_availability from whatsapp_catalog_product_mappings where messaging_business_id=${business.id}`));
  }
  async catalogMapping(businessId: string, itemId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select tany_product_id,retailer_product_id,catalog_id,whatsapp_review_status,whatsapp_availability from whatsapp_catalog_product_mappings where messaging_business_id=${business.id} and tany_product_id=${itemId} limit 1`));
    return result[0] ?? null;
  }
  async saveCatalogMapping(businessId: string, itemId: string, retailerProductId: string, catalogId: string) {
    const business = await this.businessRow(businessId);
    const product = await rows(postgresDb().execute(sql`select id from messaging_catalog_items where messaging_business_id=${business.id} and id=${itemId} and type='product' limit 1`));
    if (!product[0]) throw new Error("POSTGRES_CATALOG_PRODUCT_NOT_FOUND");
    await postgresDb().execute(sql`insert into whatsapp_catalog_product_mappings(messaging_business_id,tany_product_id,retailer_product_id,catalog_id,updated_at) values(${business.id},${itemId},${retailerProductId},${catalogId},now())
      on conflict(messaging_business_id,tany_product_id) do update set retailer_product_id=excluded.retailer_product_id,catalog_id=excluded.catalog_id,updated_at=now()`);
  }
  async getCatalogConfiguration(businessId: string) {
    const account = await this.getWhatsAppAccount(businessId);
    return { catalogId: account?.catalogId ?? "", catalogEnabled: account?.catalogEnabled === true && /^[1-9]\d{0,39}$/.test(account.catalogId ?? ""), hasAccount: !!account };
  }
  async saveCatalogConfiguration(businessId: string, catalogId: string, catalogEnabled: boolean) {
    const business = await this.businessRow(businessId);
    const result = await postgresDb().execute(sql`update whatsapp_accounts set catalog_id=${catalogId},catalog_enabled=${catalogEnabled},updated_at=now() where messaging_business_id=${business.id}`);
    if ((result as unknown as { rowCount?: number }).rowCount === 0) throw new Error("POSTGRES_ACCOUNT_NOT_FOUND");
  }
  async updateBusinessProfile(businessId: string, input: { name: string; vertical: string; active: boolean; products?: string[]; whatsappPhoneNumberId?: string; settings: Record<string, unknown> }) {
    await this.businessRow(businessId);
    const status = input.active ? "active" : "inactive";
    await postgresDb().execute(sql`update messaging_businesses set name=${input.name},vertical=${input.vertical},status=${status},products=case when ${input.products !== undefined} then ${JSON.stringify(input.products ?? [])}::jsonb else products end,whatsapp_phone_number_id=${input.whatsappPhoneNumberId ?? ""},settings=${JSON.stringify(input.settings)}::jsonb,updated_at=now() where legacy_business_id=${businessId}`);
  }
  async createBusinessProfile(input: { businessId: string; name: string; vertical: string; active: boolean; products?: string[]; whatsappPhoneNumberId: string; settings: Record<string, unknown> }) {
    await postgresDb().execute(sql`insert into messaging_businesses(legacy_business_id,name,vertical,status,whatsapp_phone_number_id,products,settings) values(${input.businessId},${input.name},${input.vertical},${input.active ? "active" : "inactive"},${input.whatsappPhoneNumberId},${JSON.stringify(input.products ?? [])}::jsonb,${JSON.stringify(input.settings)}::jsonb)`);
  }
  async setBusinessActive(businessId: string, active: boolean) {
    await this.businessRow(businessId);
    await postgresDb().execute(sql`update messaging_businesses set status=${active ? "active" : "inactive"},updated_at=now() where legacy_business_id=${businessId}`);
  }

  async getRuntimeContact(businessId: string, phone: string) {
    const business = await this.businessRow(businessId); const hash = postgresContactProjection(phone).phoneHash;
    const result = await rows(postgresDb().execute(sql`select id, legacy_customer_id, phone_enc, phone_hash, profile_name, created_at, updated_at from whatsapp_contacts where messaging_business_id = ${business.id} and phone_hash = ${hash} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_CONTACT_INCONSISTENT");
    const row = result[0]; if (!row) return null;
    if (!text(row.legacy_customer_id) || text(row.phone_hash) !== hash || decryptPostgresContactPhone(text(row.phone_enc)) !== phone) throw new Error("POSTGRES_CONTACT_INCONSISTENT");
    return row;
  }

  async getRuntimeConversation(businessId: string, legacyContactId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select id, legacy_contact_id, vertical, state, status, handoff_status, context, last_incoming_text, pending_reply, created_at, updated_at from whatsapp_conversations where messaging_business_id = ${business.id} and legacy_contact_id = ${legacyContactId} limit 2`));
    if (result.length > 1) throw new Error("POSTGRES_CONVERSATION_INCONSISTENT");
    const row = result[0];
    if (row && (!text(row.vertical) || !text(row.state) || !text(row.status) || !text(row.handoff_status))) throw new Error("POSTGRES_CONVERSATION_INCONSISTENT");
    return row ?? null;
  }
  async listRuntimeMessages(businessId: string): Promise<TenantRow[]> {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select meta_message_id,direction,type,body,payload,processing_status,delivery_status,provider_timestamp,created_at,processed_at from whatsapp_messages where messaging_business_id=${business.id} order by created_at`));
    return result.map(row => ({ ...(row.payload && typeof row.payload === "object" ? row.payload as TenantRow : {}), id: text(row.meta_message_id), businessId, messageId: text(row.meta_message_id), direction: text(row.direction), type: text(row.type), text: text(row.body), body: text(row.body), processingStatus: text(row.processing_status), deliveryStatus: text(row.delivery_status), whatsappTimestamp: row.provider_timestamp, createdAt: row.created_at, updatedAt: row.processed_at }));
  }

  /** Phase 3 message state: the row is both the idempotency record and lease. */
  async claimRuntimeIncomingMessage(row: TenantRow & { messageId: string; token: string; leaseUntil: Date }) {
    const business = await this.businessRow(row.businessId);
    const result = await rows(postgresDb().execute(sql`insert into whatsapp_messages (messaging_business_id, meta_message_id, direction, type, body, payload, processing_status, attempts, lease_token, lease_expires_at, failure_reason, provider_timestamp, delivery_status, updated_at)
      values (${business.id}, ${row.messageId}, 'incoming', ${text(row.type) || 'text'}, ${text(row.text) || null}, ${JSON.stringify(safePayload(row))}::jsonb, 'received', 1, ${row.token}, ${row.leaseUntil}, null, ${asDate(row.whatsappTimestamp)}, 'unknown', now())
      on conflict (meta_message_id) do update set processing_status = 'received', attempts = whatsapp_messages.attempts + 1, lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at, failure_reason = null, updated_at = now()
      where whatsapp_messages.messaging_business_id = excluded.messaging_business_id and (whatsapp_messages.processing_status = 'failed' or (whatsapp_messages.processing_status = 'received' and whatsapp_messages.lease_expires_at <= now()))
      returning id`));
    if (result[0]) return true;
    const existing = await rows(postgresDb().execute(sql`select messaging_business_id from whatsapp_messages where meta_message_id = ${row.messageId} limit 1`));
    if (existing[0] && text(existing[0].messaging_business_id) !== business.id) throw new Error('POSTGRES_MESSAGE_TENANT_MISMATCH');
    return false;
  }

  async finishRuntimeIncomingMessage(businessId: string, messageId: string, token: string, status: 'processed' | 'failed', failureReason: string | null) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`update whatsapp_messages set processing_status = ${status}, lease_token = null, lease_expires_at = null, failure_reason = ${failureReason}, processed_at = ${status === 'processed' ? new Date() : null}, updated_at = now()
      where messaging_business_id = ${business.id} and meta_message_id = ${messageId} and direction = 'incoming' and lease_token = ${token} returning id`));
    if (!result[0]) throw new Error('POSTGRES_MESSAGE_LEASE_REPLACED');
  }

  async getRuntimePreparedReply(businessId: string, messageId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select payload from whatsapp_messages where messaging_business_id = ${business.id} and meta_message_id = ${messageId} and direction = 'incoming' limit 2`));
    if (result.length > 1) throw new Error('POSTGRES_MESSAGE_INCONSISTENT');
    const payload = result[0]?.payload;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as DbRow).preparedResult ?? null : null;
  }

  async storeRuntimePreparedReply(businessId: string, messageId: string, token: string, preparedResult: unknown) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`update whatsapp_messages set payload = payload || ${JSON.stringify({ preparedResult: safePayload(preparedResult) })}::jsonb, updated_at = now()
      where messaging_business_id = ${business.id} and meta_message_id = ${messageId} and direction = 'incoming' and lease_token = ${token} returning id`));
    if (!result[0]) throw new Error('POSTGRES_MESSAGE_LEASE_REPLACED');
  }

  async getRuntimeProductSequenceSkips(businessId: string, messageId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select payload from whatsapp_messages where messaging_business_id = ${business.id} and meta_message_id = ${messageId} and direction = 'incoming' limit 2`));
    if (result.length > 1) throw new Error('POSTGRES_MESSAGE_INCONSISTENT');
    const payload = result[0]?.payload;
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as DbRow).catalogSequenceSkips ?? {} : {};
  }

  async storeRuntimeProductSequenceSkip(businessId: string, messageId: string, token: string, index: number, skip: unknown) {
    const current = await this.getRuntimeProductSequenceSkips(businessId, messageId);
    await this.storeRuntimeMessagePayload(businessId, messageId, token, { catalogSequenceSkips: { ...(current as DbRow), [String(index)]: safePayload(skip) } });
  }

  private async storeRuntimeMessagePayload(businessId: string, messageId: string, token: string, value: DbRow) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`update whatsapp_messages set payload = payload || ${JSON.stringify(value)}::jsonb, updated_at = now()
      where messaging_business_id = ${business.id} and meta_message_id = ${messageId} and direction = 'incoming' and lease_token = ${token} returning id`));
    if (!result[0]) throw new Error('POSTGRES_MESSAGE_LEASE_REPLACED');
  }

  async hasRuntimeOutgoingReply(businessId: string, sourceMessageId: string) {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select id from whatsapp_messages where messaging_business_id = ${business.id} and source_message_id = ${sourceMessageId} and direction = 'outgoing' limit 2`));
    if (result.length > 1) throw new Error('POSTGRES_OUTGOING_REPLY_INCONSISTENT');
    return !!result[0];
  }

  async storeRuntimeOutgoingReply(row: TenantRow & { incomingMessageId: string; messageId: string }) {
    const business = await this.businessRow(row.businessId);
    const saved = await rows(postgresDb().execute(sql`insert into whatsapp_messages (messaging_business_id, meta_message_id, source_message_id, direction, type, body, payload, processing_status, delivery_status, processed_at, updated_at)
      values (${business.id}, ${row.messageId}, ${row.incomingMessageId}, 'outgoing', ${text(row.type) || 'text'}, ${text(row.text || row.body) || null}, ${JSON.stringify(safePayload(row))}::jsonb, 'processed', 'sent', now(), now())
      on conflict (messaging_business_id, source_message_id) do nothing returning id`));
    if (saved[0]) return true;
    const existing = await rows(postgresDb().execute(sql`select messaging_business_id from whatsapp_messages where source_message_id = ${row.incomingMessageId} and direction = 'outgoing' limit 2`));
    if (existing.length !== 1 || text(existing[0].messaging_business_id) !== business.id) throw new Error('POSTGRES_OUTGOING_REPLY_INCONSISTENT');
    return false;
  }

  async recordRuntimeDeliveryEvent(row: TenantRow & { messageId: string; status: string }) {
    const business = await this.businessRow(row.businessId);
    const eventId = text(row.id); if (!eventId) throw new Error('POSTGRES_EVENT_ID_REQUIRED');
    const inserted = await rows(postgresDb().execute(sql`insert into whatsapp_message_events (messaging_business_id, meta_event_id, meta_message_id, status, payload, occurred_at)
      values (${business.id}, ${eventId}, ${row.messageId}, ${row.status}, ${JSON.stringify(safePayload(row))}::jsonb, ${asDate(row.at)}) on conflict (meta_event_id) do nothing returning id`));
    if (!inserted[0]) return false;
    const delivery = text(row.status);
    await postgresDb().execute(sql`update whatsapp_messages set delivery_status = case
      when ${delivery} = 'read' then 'read'
      when ${delivery} = 'delivered' and delivery_status <> 'read' then 'delivered'
      when ${delivery} = 'failed' and delivery_status not in ('read', 'delivered') then 'failed'
      else delivery_status end, updated_at = now()
      where messaging_business_id = ${business.id} and meta_message_id = ${row.messageId} and direction = 'outgoing'`);
    return true;
  }

  async mirrorAccount(row: TenantRow) {
    const business = await this.businessRow(row.businessId);
    const phoneNumberId = text(row.phoneNumberId) || null;
    const tokenSecretName = text(row.tokenSecretName);
    if (phoneNumberId) {
      const existing = await rows(postgresDb().execute(sql`select messaging_business_id from whatsapp_phone_mappings where phone_number_id = ${phoneNumberId} limit 1`));
      if (existing[0] && text(existing[0].messaging_business_id) !== business.id) throw new Error("POSTGRES_PHONE_ALREADY_CONNECTED");
    }
    const saved = await rows(postgresDb().execute(sql`insert into whatsapp_accounts (messaging_business_id, product, waba_id, phone_number_id, display_phone, display_name, token_secret_name, status, test_passed, validation_mode, test_message, tested_at, setup_type, business_name, setup_step, revision, catalog_id, catalog_enabled, activated_at, internal_testing_active, test_status, updated_at)
      values (${business.id}, ${text(row.vertical) || null}, ${text(row.wabaId) || null}, ${phoneNumberId}, ${text(row.displayPhone) || null}, ${text(row.displayName) || null}, ${tokenSecretName}, ${text(row.status) || "pending"}, ${row.testPassed === true}, ${text(row.validationMode) || null}, ${text(row.testMessage) || null}, ${asDate(row.testedAt)}, ${text(row.setupType) || "existing"}, ${text(row.businessName)}, ${Number(row.setupStep) || 5}, ${Number(row.revision) || 1}, ${text(row.catalogId)}, ${row.catalogEnabled === true}, ${asDate(row.activatedAt)}, ${row.internalTestingActive === true}, ${text(row.testStatus) || "unverified"}, now())
      on conflict (messaging_business_id) do update set product = excluded.product, waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id, display_phone = excluded.display_phone, display_name = excluded.display_name, token_secret_name = excluded.token_secret_name, status = excluded.status, test_passed = excluded.test_passed, validation_mode = excluded.validation_mode, test_message = excluded.test_message, tested_at = excluded.tested_at, setup_type=excluded.setup_type, business_name=excluded.business_name, setup_step=excluded.setup_step, revision=excluded.revision, catalog_id=excluded.catalog_id, catalog_enabled=excluded.catalog_enabled, activated_at=excluded.activated_at, internal_testing_active=excluded.internal_testing_active, test_status=excluded.test_status, updated_at = now()
      returning id`));
    const accountId = text(saved[0]?.id); if (!accountId) throw new Error("POSTGRES_ACCOUNT_SAVE_FAILED");
    if (phoneNumberId) await postgresDb().execute(sql`insert into whatsapp_phone_mappings (phone_number_id, messaging_business_id, whatsapp_account_id, updated_at) values (${phoneNumberId}, ${business.id}, ${accountId}, now()) on conflict (phone_number_id) do update set whatsapp_account_id = excluded.whatsapp_account_id, updated_at = now()`);
    await postgresDb().execute(sql`update messaging_businesses set whatsapp_phone_number_id=${phoneNumberId ?? ""},updated_at=now() where id=${business.id}`);
  }

  async assertWhatsAppPhoneAvailable(businessId: string, phoneNumberId: string): Promise<void> {
    const business = await this.businessRow(businessId);
    const result = await rows(postgresDb().execute(sql`select 1 from whatsapp_accounts where phone_number_id=${phoneNumberId} and messaging_business_id<>${business.id} union all select 1 from whatsapp_phone_mappings where phone_number_id=${phoneNumberId} and messaging_business_id<>${business.id} limit 1`));
    if (result.length) throw new Error("POSTGRES_PHONE_ALREADY_CONNECTED");
  }

  async mirrorMessage(row: TenantRow) {
    const business = await this.businessRow(row.businessId); const metaMessageId = text(row.messageId); if (!metaMessageId) throw new Error("POSTGRES_MESSAGE_ID_REQUIRED");
    await postgresDb().execute(sql`insert into whatsapp_messages (messaging_business_id, meta_message_id, direction, type, body, payload, processing_status, attempts, lease_token, lease_expires_at, failure_reason, provider_timestamp, processed_at, updated_at)
      values (${business.id}, ${metaMessageId}, ${text(row.direction)}, ${text(row.type) || "text"}, ${text(row.text || row.body) || null}, ${safePayload(row)}, ${text(row.processingStatus) || "pending"}, ${Number(row.attempts) || 0}, ${text(row.processingToken) || null}, ${asDate(row.leaseUntil)}, ${text(row.error) || null}, ${asDate(row.whatsappTimestamp)}, ${text(row.processingStatus) === "processed" ? new Date() : null}, now())
      on conflict (meta_message_id) do update set processing_status = excluded.processing_status, attempts = excluded.attempts, lease_token = excluded.lease_token, lease_expires_at = excluded.lease_expires_at, failure_reason = excluded.failure_reason, processed_at = excluded.processed_at, updated_at = now()`);
  }

  async mirrorDeliveryEvent(row: TenantRow & { messageId: string; status: string }) {
    const business = await this.businessRow(row.businessId); const eventId = text(row.id); if (!eventId) throw new Error("POSTGRES_EVENT_ID_REQUIRED");
    await postgresDb().execute(sql`insert into whatsapp_message_events (messaging_business_id, meta_event_id, meta_message_id, status, payload, occurred_at) values (${business.id}, ${eventId}, ${row.messageId}, ${row.status}, ${safePayload(row)}, ${asDate(row.at)}) on conflict (meta_event_id) do nothing`);
  }

  async mirrorTemplate(row: TenantRow) {
    const business = await this.businessRow(row.businessId); const name = text(row.name); const language = text(row.language) || "en"; if (!name) throw new Error("POSTGRES_TEMPLATE_NAME_REQUIRED");
    await postgresDb().execute(sql`insert into whatsapp_templates (messaging_business_id, legacy_template_id, meta_template_id, name, language, category, status, body, variables, definition, updated_at) values (${business.id}, ${row.id}, ${text(row.metaTemplateId) || null}, ${name}, ${language}, ${text(row.category) || null}, ${text(row.status) || "draft"}, ${text(row.body) || ""}, ${safePayload(row.variables)}, ${safePayload(row)}, now()) on conflict (messaging_business_id, name, language) do update set legacy_template_id = excluded.legacy_template_id, meta_template_id = excluded.meta_template_id, category = excluded.category, status = excluded.status, body = excluded.body, variables = excluded.variables, definition = excluded.definition, updated_at = now()`);
  }

  async mirrorContact(row: TenantRow) {
    const business = await this.businessRow(row.businessId); const phoneEnc = text(row.phoneEnc); const phoneHash = text(row.phoneHash); if (!phoneEnc || !phoneHash) throw new Error("POSTGRES_CONTACT_PHONE_REQUIRED");
    await postgresDb().execute(sql`insert into whatsapp_contacts (messaging_business_id, legacy_customer_id, phone_enc, phone_hash, wa_id, profile_name, updated_at) values (${business.id}, ${text(row.customerId) || null}, ${phoneEnc}, ${phoneHash}, ${text(row.waId) || null}, ${text(row.profileName) || null}, now()) on conflict (messaging_business_id, phone_hash) do update set wa_id = excluded.wa_id, profile_name = excluded.profile_name, updated_at = now()`);
  }

  async mirrorConversation(row: TenantRow & { contactId: string }) {
    const business = await this.businessRow(row.businessId);
    await postgresDb().execute(sql`insert into whatsapp_conversations (messaging_business_id, legacy_contact_id, vertical, state, status, handoff_status, context, last_incoming_text, pending_reply, last_incoming_at, last_outgoing_at, updated_at) values (${business.id}, ${row.contactId}, ${text(row.vertical) || null}, ${text(row.state) || "start"}, ${text(row.status) || "active"}, ${text(row.handoffStatus) || "bot"}, ${safePayload(row.context)}, ${text(row.lastIncomingText)}, ${text(row.pendingReply) || null}, ${asDate(row.lastIncomingAt)}, ${asDate(row.lastOutgoingAt)}, now()) on conflict (messaging_business_id, legacy_contact_id) do update set vertical = excluded.vertical, state = excluded.state, status = excluded.status, handoff_status = excluded.handoff_status, context = excluded.context, last_incoming_text = excluded.last_incoming_text, pending_reply = excluded.pending_reply, last_incoming_at = excluded.last_incoming_at, last_outgoing_at = excluded.last_outgoing_at, updated_at = now()`);
  }

  async mirrorAutomationState(row: TenantRow & { conversationId: string; automationKey: string }) {
    const business = await this.businessRow(row.businessId);
    await postgresDb().execute(sql`insert into whatsapp_automation_state (messaging_business_id, conversation_id, automation_key, status, state, context, paused_at, resumed_at, updated_at) values (${business.id}, ${row.conversationId}, ${row.automationKey}, ${text(row.status) || "active"}, ${text(row.state) || "start"}, ${safePayload(row.context)}, ${asDate(row.pausedAt)}, ${asDate(row.resumedAt)}, now()) on conflict (conversation_id, automation_key) do update set status = excluded.status, state = excluded.state, context = excluded.context, paused_at = excluded.paused_at, resumed_at = excluded.resumed_at, updated_at = now()`);
  }

  async recordWebhookEvent(row: TenantRow & { metaEventId: string }) {
    const business = await this.businessRow(row.businessId);
    await postgresDb().execute(sql`insert into whatsapp_webhook_events (messaging_business_id, meta_event_id, payload, processing_status, attempts, lease_token, lease_expires_at, failure_reason, received_at, processed_at, updated_at) values (${business.id}, ${row.metaEventId}, ${safePayload(row.payload)}, ${text(row.processingStatus) || "pending"}, ${Number(row.attempts) || 0}, ${text(row.leaseToken) || null}, ${asDate(row.leaseExpiresAt)}, ${text(row.failureReason) || null}, ${asDate(row.receivedAt) || new Date()}, ${asDate(row.processedAt)}, now()) on conflict (meta_event_id) do nothing`);
  }
}

function account(row: DbRow, businessId: string): WhatsAppAccountRecord {
  return { id: text(row.id), businessId, phoneNumberId: text(row.phone_number_id), wabaId: text(row.waba_id) || undefined, displayPhone: text(row.display_phone) || undefined, displayName: text(row.display_name) || undefined, tokenSecretName: text(row.token_secret_name) || undefined, status: text(row.status), vertical: text(row.product), setupType: text(row.setup_type), businessName: text(row.business_name), setupStep: Number(row.setup_step) || 1, revision: Number(row.revision) || 1, testPassed: row.test_passed === true, testMessage: text(row.test_message), validationMode: text(row.validation_mode) || null, testedAt: asDate(row.tested_at), catalogId: text(row.catalog_id), catalogEnabled: row.catalog_enabled === true, activatedAt: asDate(row.activated_at), internalTestingActive: row.internal_testing_active === true, testStatus: text(row.test_status) || "unverified" };
}
function catalogItem(row: DbRow) {
  return { id: text(row.id), type: text(row.type), name: text(row.name), description: text(row.description), price: Number(row.price), available: row.available === true, category: text(row.category) || null, metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}, createdAt: asDate(row.created_at), updatedAt: asDate(row.updated_at) };
}
function safePayload(value: unknown) {
  const forbidden = new Set(["accessToken", "access_token", "token", "refresh_token", "id_token"]);
  const cleanse = (input: unknown): unknown => Array.isArray(input) ? input.map(cleanse) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter(([key]) => !forbidden.has(key)).map(([key, child]) => [key, cleanse(child)])) : input;
  return cleanse(value ?? {});
}
