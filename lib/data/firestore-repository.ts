import "server-only";
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { BusinessRecord, EntitlementRecord, MessagingRepository, SubscriptionEntitlementWrite, SubscriptionRecord, TenantRow, WhatsAppAccountRecord } from "./types";
const millis = (value: unknown) => value && typeof value === "object" && "toMillis" in value ? Number((value as { toMillis(): number }).toMillis()) : 0;
const tenantTables = new Set(["whatsapp_accounts", "customers", "conversations", "messages", "message_delivery_events", "automations", "automation_events", "automation_runs", "templates", "campaigns", "dashboard_handoffs"]);
function tenantRow(id: string, data: Record<string, unknown>): TenantRow { return { ...data, id, businessId: String(data.businessId ?? "") }; }
function account(id: string, data: Record<string, unknown>): WhatsAppAccountRecord {
  return { ...tenantRow(id, data), phoneNumberId: String(data.phoneNumberId ?? ""), status: String(data.status ?? ""), wabaId: typeof data.wabaId === "string" ? data.wabaId : undefined, displayPhone: typeof data.displayPhone === "string" ? data.displayPhone : undefined, tokenSecretName: typeof data.tokenSecretName === "string" ? data.tokenSecretName : undefined };
}
export class FirestoreMessagingRepository implements MessagingRepository {
  async getBusiness(id: string): Promise<BusinessRecord | null> {
    const data = (await adminDb.collection("businesses").doc(id).get()).data();
    if (!data) return null;
    return { id, name: String(data.name ?? ""), vertical: String(data.vertical ?? ""), active: data.active === true, products: Array.isArray(data.products) ? data.products.filter((v): v is string => typeof v === "string") : [], whatsappPhoneNumberId: String(data.whatsappPhoneNumberId ?? ""), settings: data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings as Record<string, unknown> : {} };
  }
  async findActiveBusinessByPhoneNumberId(phoneNumberId: string): Promise<BusinessRecord | null> {
    // Never pick an arbitrary tenant when legacy data contains duplicate sender IDs.
    const result = await adminDb.collection("businesses").where("whatsappPhoneNumberId", "==", phoneNumberId).where("active", "==", true).get();
    if (result.docs.length !== 1) return null;
    return this.getBusiness(result.docs[0].id);
  }
  async getSubscriptionAndEntitlement(businessId: string) {
    const [subscription, entitlement] = await Promise.all([adminDb.collection("subscriptions").doc(businessId).get(), adminDb.collection("entitlements").doc(businessId).get()]);
    const s = subscription.data(), e = entitlement.data();
    return { subscription: s ? { businessId: String(s.businessId ?? ""), plan: String(s.plan ?? ""), status: String(s.status ?? ""), startedAt: millis(s.startedAt), expiresAt: millis(s.expiresAt) } satisfies SubscriptionRecord : null, entitlement: e ? { businessId: String(e.businessId ?? ""), whatsappAutomation: e.whatsappAutomation === true, campaigns: e.campaigns === true, advancedAnalytics: e.advancedAnalytics === true, aiAssistant: e.aiAssistant === true } satisfies EntitlementRecord : null };
  }
  async writeSubscriptionEntitlement(input: SubscriptionEntitlementWrite) {
    await adminDb.runTransaction(async tx => {
      if (!(await tx.get(adminDb.collection("businesses").doc(input.businessId))).exists) throw new Error("Business not found.");
      tx.set(adminDb.collection("subscriptions").doc(input.businessId), {
        businessId: input.businessId, product: "whatsappAutomation", plan: input.plan, status: input.status,
        startedAt: Timestamp.fromMillis(input.startedAt), expiresAt: Timestamp.fromMillis(input.expiresAt), updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(adminDb.collection("entitlements").doc(input.businessId), {
        businessId: input.businessId, whatsappAutomation: input.whatsappAutomation, campaigns: input.campaigns,
        advancedAnalytics: input.advancedAnalytics, aiAssistant: input.aiAssistant, updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  async getWhatsAppAccount(businessId: string) {
    const snapshot = await adminDb.collection("whatsapp_accounts").doc(businessId).get();
    const data = snapshot.data();
    return data && data.businessId === businessId ? account(snapshot.id, data) : null;
  }
  async findWhatsAppAccountByPhoneNumberId(phoneNumberId: string) {
    const result = await adminDb.collection("whatsapp_accounts").where("phoneNumberId", "==", phoneNumberId).get();
    if (result.docs.length !== 1) return null;
    return account(result.docs[0].id, result.docs[0].data());
  }
  async getTenantRow(table: string, businessId: string, id: string) {
    if (!tenantTables.has(table)) throw new Error("Unsupported tenant table.");
    const snapshot = await adminDb.collection(table).doc(id).get(); const data = snapshot.data();
    return data?.businessId === businessId ? tenantRow(snapshot.id, data) : null;
  }
  async listTenantRows(table: string, businessId: string) {
    if (!tenantTables.has(table)) throw new Error("Unsupported tenant table.");
    const result = await adminDb.collection(table).where("businessId", "==", businessId).get();
    return result.docs.map(doc => tenantRow(doc.id, doc.data()));
  }
  async updateMessageState(businessId: string, id: string, update: Record<string, unknown>) {
    const current = await this.getTenantRow("messages", businessId, id); if (!current) throw new Error("Message not found.");
    await adminDb.collection("messages").doc(id).update(update);
    return { ...current, ...update };
  }
  async hasOutgoingReply(businessId: string, incomingMessageId: string) { return !!await this.getTenantRow("messages", businessId, `reply_${incomingMessageId}`); }
  async storeOutgoingReply(row: TenantRow & { incomingMessageId: string }) { await this.upsertTenantRow("messages", row); }
  async storeDeliveryEvent(row: TenantRow & { messageId: string; status: string }) { await this.upsertTenantRow("message_delivery_events", row); }
  async reservePhoneMapping(businessId: string, phoneNumberId: string) {
    await adminDb.runTransaction(async tx => {
      const ref = adminDb.collection("whatsapp_phone_mappings").doc(phoneNumberId); const existing = (await tx.get(ref)).data();
      if (existing && existing.businessId !== businessId) throw new Error("PHONE_ALREADY_CONNECTED");
      if (!existing) tx.create(ref, { businessId, accountId: businessId });
    });
  }
  async compareAndSwapWhatsAppSetup(businessId: string, expectedRevision: number, update: TenantRow) {
    const ref = adminDb.collection("whatsapp_accounts").doc(businessId);
    return adminDb.runTransaction(async tx => { const current = (await tx.get(ref)).data(); if (!current || current.businessId !== businessId || current.revision !== expectedRevision) throw new Error("STALE_SETUP_REVISION"); const revision = expectedRevision + 1; tx.update(ref, { ...update, revision }); return revision; });
  }
  async upsertTenantRow(table: string, row: TenantRow) { await adminDb.collection(table).doc(row.id).set(row, { merge: true }); }
}
