import "server-only";
import { isSendableWithBodyParameters } from "@/lib/templates/model";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { DashboardSession } from "@/lib/admin/dashboard-access";
import { getOperationsData, createCampaignDraft, saveOperationsConfiguration, setConversationHandoff } from "@/lib/admin/operations-service";
import { isClientOperationSection } from "@/lib/admin/operations-types";
import { OperationsAccessError, requireClientConnection } from "@/lib/admin/client-access";
import { documentId, serverTimestamp } from "@/lib/messaging/services/shared";
import { getBusinessConfig } from "@/lib/messaging/services/business-config-service";
import { sendWhatsAppMessage } from "@/lib/messaging/whatsapp";
import { sendingAccessToken } from "@/lib/whatsapp/runtime-account";
import { automationPersistence } from "@/lib/automations/persistence";
import { getRuntimeRecord, mutateRuntimeRecord, mutateRuntimeRecordById, postgresRuntimeMode } from "@/lib/messaging/services/postgres-runtime-records";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";

export function operationsBusiness(session: DashboardSession, requested?: string) {
  if (session.role === "selector") throw new OperationsAccessError("BUSINESS_REQUIRED", "Select a business.", 400);
  if (session.role === "business") {
    if (requested && requested !== session.businessId) throw new OperationsAccessError("FORBIDDEN", "Business access denied.");
    return session.businessId;
  }
  if (!requested) throw new OperationsAccessError("BUSINESS_REQUIRED", "Select a business.", 400);
  return documentId(requested);
}
export async function readClientOperations(session: DashboardSession, requested: string | undefined, section: string) {
  const businessId = operationsBusiness(session, requested);
  if (!isClientOperationSection(section)) throw new OperationsAccessError("ADMIN_ONLY", "This page is available to Super Admin only.");
  await requireClientConnection(businessId);
  const data = await getOperationsData(businessId);
  return {
    ...data, audience: "client" as const, accounts: [], setupRequests: [],
    messages: data.messages.map(m => ({ ...m, failure: m.failure ? "Message could not be sent." : "" })),
    health: { verification: "", lastReceived: null, incoming: 0, failed: 0, duplicates: null, latency: null, lastError: "" },
  };
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new OperationsAccessError("INVALID_INPUT", "Check the request.", 400);
  return input as Record<string, unknown>;
}
async function conversationRef(businessId: string, id: string) {
  if (postgresRuntimeMode()) {
    const data = await getRuntimeRecord<Record<string, unknown> & { id: string; businessId: string }>("conversations", businessId, documentId(id));
    if (!data) throw new OperationsAccessError("NOT_FOUND", "Conversation not found.", 404);
    return { ref: null, data };
  }
  const ref = adminDb.collection("conversations").doc(documentId(id));
  const data = (await ref.get()).data();
  if (!data || data.businessId !== businessId) throw new OperationsAccessError("NOT_FOUND", "Conversation not found.", 404);
  return { ref, data };
}
export async function mutateClientOperations(session: DashboardSession, requested: string | undefined, action: string, input: unknown, internalConsole = false) {
  const businessId = operationsBusiness(session, requested);
  if (!internalConsole) await requireClientConnection(businessId);
  const value = object(input);
  if (action === "configuration") { await saveOperationsConfiguration(businessId, value, internalConsole); return; }
  if (action === "campaign") { await createCampaignDraft(businessId, value, internalConsole); return; }
  if (typeof value.id !== "string") throw new OperationsAccessError("INVALID_INPUT", "Choose a conversation.", 400);
  const { ref } = await conversationRef(businessId, value.id);
  if (action === "read") {
    if (postgresRuntimeMode()) await mutateRuntimeRecordById("conversations", documentId(value.id), current => ({ ...current, dashboardReadAt: new Date(), unreadCount: 0 }));
    else await ref!.update({ dashboardReadAt: serverTimestamp(), unreadCount: 0 });
    return;
  }
  if (action === "handoff") {
    if (typeof value.human !== "boolean") throw new OperationsAccessError("INVALID_INPUT", "Choose bot or human mode.", 400);
    await setConversationHandoff(businessId, value.id, value.human, internalConsole);
    return;
  }
  throw new OperationsAccessError("INVALID_ACTION", "Unsupported action.", 400);
}

/** Operator sends live beside the flow engine; they never route, confirm orders or change flow context. */
export async function sendOperatorMessage(session: DashboardSession, requested: string | undefined, input: unknown, internalConsole = false) {
  const businessId = operationsBusiness(session, requested);
  if (!internalConsole) await requireClientConnection(businessId);
  const value = object(input);
  if (typeof value.id !== "string" || typeof value.requestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.requestId))
    throw new OperationsAccessError("INVALID_INPUT", "Choose a conversation and retry.", 400);
  const { ref: conversation, data } = await conversationRef(businessId, value.id);
  if (data.status !== "handed_off") throw new OperationsAccessError("HANDOFF_REQUIRED", "Hand off to a human before replying.", 409);
  const phone = data.customerPhone;
  if (typeof phone !== "string" || !/^[1-9]\d{7,14}$/.test(phone)) throw new OperationsAccessError("INVALID_INPUT", "Customer phone is unavailable.", 400);
  const business = await getBusinessConfig(businessId);
  if (!business?.active) throw new OperationsAccessError("NOT_FOUND", "Business unavailable.", 404);
  let text = typeof value.text === "string" ? value.text.trim() : "";
  let template: { name: string; language: { code: string }; components?: unknown[] } | undefined;
  if (typeof value.templateId === "string" && value.templateId) {
    const raw = await automationPersistence().get("templates", businessId, documentId(value.templateId));
    if (!raw || raw.businessId !== businessId || raw.status !== "approved" || !/^[a-z0-9_]{1,120}$/.test(String(raw.name ?? "")) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(String(raw.language ?? "")))
      throw new OperationsAccessError("INVALID_TEMPLATE", "Choose an approved template from this business.", 400);
    const parts = Array.isArray(raw.components) ? raw.components : [];
    if (!isSendableWithBodyParameters(parts))
      throw new OperationsAccessError("TEMPLATE_FIELDS_REQUIRED", "This template needs unsupported media or button fields. Choose a text template.", 400);
    const body = typeof raw.body === "string" ? raw.body : parts.find((c: { type?: string }) => c.type?.toUpperCase() === "BODY")?.text ?? "";
    const numbers = [...new Set(Array.from(String(body).matchAll(/\{\{(\d+)\}\}/g), m => Number(m[1])))].sort((a,b) => a-b);
    const parameters = Array.isArray(value.parameters) ? value.parameters : [];
    if (parameters.length !== numbers.length || numbers.some((n,i) => n !== i+1) || parameters.some(p => typeof p !== "string" || !p.trim() || p.length > 1000))
      throw new OperationsAccessError("TEMPLATE_FIELDS_REQUIRED", "Fill in every template field.", 400);
    text = String(body).replace(/\{\{(\d+)\}\}/g, (_, n) => parameters[Number(n)-1]);
    template = { name: String(raw.name), language: { code: String(raw.language) }, ...(parameters.length ? { components: [{ type: "body", parameters: parameters.map(p => ({ type: "text", text: p })) }] } : {}) };
  } else {
    if (!text || text.length > 4096) throw new OperationsAccessError("INVALID_INPUT", "Enter a message up to 4,096 characters.", 400);
    const incoming = postgresRuntimeMode() ? await new PostgresMessagingRepository().listRuntimeMessages(businessId).then(rows => rows.filter(row => row.customerPhone === phone && row.direction === "incoming")) : (await adminDb.collection("messages").where("businessId", "==", businessId).where("customerPhone", "==", phone).where("direction", "==", "incoming").get()).docs.map(doc => doc.data());
    const latest = Math.max(0, ...incoming.map(data => /^\d{10}$/.test(String(data.whatsappTimestamp ?? "")) ? Number(data.whatsappTimestamp) * 1000 : data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : typeof data.createdAt === "string" ? Date.parse(data.createdAt) || 0 : 0));
    if (!latest || Date.now() - latest >= 24 * 3600000) throw new OperationsAccessError("TEMPLATE_REQUIRED", "The reply window has closed. Choose an approved template.", 409);
  }
  const id = `operator_${createHash("sha256").update(`${businessId}:${value.requestId}`).digest("hex")}`;
  const messageRef = postgresRuntimeMode() ? null : adminDb.collection("messages").doc(id);
  let claimed = false;
  let duplicateStatus = "unknown";
  const messageData = { id, businessId, customerPhone: phone, conversationId: value.id, direction: "outgoing", type: template ? "template" : "text", text, messageId: id, templateId: typeof value.templateId === "string" ? value.templateId : "", source: "operator", processingStatus: "received", deliveryStatus: "sending", createdAt: postgresRuntimeMode() ? new Date() : serverTimestamp() };
  if (postgresRuntimeMode()) await mutateRuntimeRecord("messages", businessId, id, existing => {
    if (existing) {
      if (existing.customerPhone !== phone || existing.text !== text || (existing.templateId ?? "") !== (value.templateId ?? "")) throw new OperationsAccessError("REQUEST_CONFLICT", "This send request was already used for another message.", 409);
      duplicateStatus = String(existing.deliveryStatus ?? "unknown"); return existing;
    }
    claimed = true; return messageData;
  });
  else claimed = await adminDb.runTransaction(async tx => {
    const existing = (await tx.get(messageRef!)).data();
    if (existing) {
      if (existing.businessId !== businessId || existing.customerPhone !== phone || existing.text !== text || (existing.templateId ?? "") !== (value.templateId ?? "")) throw new OperationsAccessError("REQUEST_CONFLICT", "This send request was already used for another message.", 409);
      duplicateStatus = String(existing.deliveryStatus ?? "unknown"); return false;
    }
    const { id: _id, ...row } = messageData; void _id; tx.create(messageRef!, row); return true;
  });
  if (!claimed) return { duplicate: true, status: duplicateStatus };
  try {
    // Recheck access immediately before the external operation.
    if (!internalConsole) await requireClientConnection(businessId);
    let sent;
    if (template) {
      const token = await sendingAccessToken(business.whatsappPhoneNumberId);
      if (!token) throw new Error("Credential unavailable");
      const response = await fetch(`https://graph.facebook.com/v26.0/${business.whatsappPhoneNumberId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "template", template }),
      });
      sent = await response.json();
      if (!response.ok || !sent.messages?.[0]?.id) throw new Error("Template send failed");
    } else sent = await sendWhatsAppMessage({ phoneNumberId: business.whatsappPhoneNumberId, to: phone, reply: text });
    const providerId = sent?.messages?.[0]?.id;
    if (typeof providerId !== "string" || !providerId) throw new Error("Missing send receipt");
    if (postgresRuntimeMode()) {
      await mutateRuntimeRecordById("messages", id, current => ({ ...current, messageId: providerId, processingStatus: "processed", deliveryStatus: "sent", updatedAt: new Date() }));
      await mutateRuntimeRecordById("conversations", documentId(value.id), current => ({ ...current, dashboardReadAt: new Date() }));
    } else { await messageRef!.update({ messageId: providerId, processingStatus: "processed", deliveryStatus: "sent", updatedAt: serverTimestamp() }); await conversation!.update({ dashboardReadAt: serverTimestamp() }); }
    return { duplicate: false, status: "sent" };
  } catch {
    if (postgresRuntimeMode()) await mutateRuntimeRecordById("messages", id, current => ({ ...current, processingStatus: "failed", deliveryStatus: "failed", updatedAt: new Date() }));
    else await messageRef!.update({ processingStatus: "failed", deliveryStatus: "failed", updatedAt: serverTimestamp() });
    throw new OperationsAccessError("SEND_FAILED", "WhatsApp could not confirm this send. Check message status before composing another reply.", 502);
  }
}
