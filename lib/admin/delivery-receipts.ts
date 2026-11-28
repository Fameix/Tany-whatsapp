import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { databaseMode, postgresShadowWrite, repositoryFor } from "@/lib/data/repository";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { d1For } from "@/worker/bindings";
import { documentId, serverTimestamp } from "@/lib/messaging/services/shared";
import { deliveryErrorFrom } from "@/lib/whatsapp/delivery-error";
const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 0 };
export function receiptStatus(current: string, next: string) {
  if (current === "failed" && next === "sent") return current;
  if (next === "failed") return ["delivered", "read"].includes(current) ? current : next;
  return (rank[next] ?? -1) >= (rank[current] ?? -1) ? next : current;
}
/** Provider receipt metadata only. Does not route messages or mutate conversation/order state. */
export async function recordDeliveryReceipts(businessId: string, statuses: unknown, request?: Request) {
  documentId(businessId);
  if (!Array.isArray(statuses)) return;
  for (const event of statuses.slice(0, 100)) {
    if (!event || typeof event.id !== "string" || event.id.length > 300 || !Object.hasOwn(rank, event.status) || !/^\d{10}$/.test(event.timestamp ?? "")) continue;
    const eventId = createHash("sha256").update(`${businessId}:${event.id}:${event.status}:${event.timestamp}`).digest("hex");
    if (databaseMode() === "d1") {
      if (!request) throw new Error("A Worker request is required for D1 delivery receipts.");
      const repository = await repositoryFor("d1", d1For(request));
      if (await repository.getTenantRow("message_delivery_events", businessId, eventId)) continue;
      await repository.storeDeliveryEvent({ id: eventId, businessId, messageId: event.id, status: event.status, at: new Date(Number(event.timestamp) * 1000).toISOString(), createdAt: Date.now() });
      for (const message of await repository.listTenantRows("messages", businessId)) if (message.messageId === event.id && message.direction === "outgoing") await repository.updateMessageState(businessId, message.id, { deliveryStatus: receiptStatus(String(message.deliveryStatus ?? "unknown"), event.status), updatedAt: Date.now() });
      continue;
    }
    if (databaseMode() === "dual-write" || databaseMode() === "postgres") {
      // Meta's reason for a failure (code, title, details) is kept so Message Status can show it.
      const error = event.status === "failed" ? deliveryErrorFrom(event) : null;
      console.info("[WHATSAPP_DELIVERY_STATUS]", { messageId: event.id, status: event.status, errorCode: error?.code ?? null });
      try {
        await new PostgresMessagingRepository().recordRuntimeDeliveryEvent({ id: eventId, businessId, messageId: event.id, status: event.status, at: new Date(Number(event.timestamp) * 1000).toISOString(), createdAt: Date.now(), ...(error ? { error } : {}) });
      } catch (error) {
        console.warn("[POSTGRES_RECEIPT_PERSISTENCE_FAILED]", { businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
        throw error;
      }
      continue;
    }
    const ref = adminDb.collection("message_delivery_events").doc(eventId);
    await adminDb.runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return;
      const messages = await tx.get(adminDb.collection("messages").where("businessId", "==", businessId).where("messageId", "==", event.id).where("direction", "==", "outgoing"));
      tx.create(ref, { businessId, messageId: event.id, status: event.status, at: new Date(Number(event.timestamp) * 1000).toISOString(), createdAt: serverTimestamp() });
      for (const message of messages.docs) tx.update(adminDb.collection("messages").doc(message.id), { deliveryStatus: receiptStatus(message.data().deliveryStatus ?? "unknown", event.status), updatedAt: serverTimestamp() });
    });
    await postgresShadowWrite("delivery-event", { id: eventId, businessId, messageId: event.id, status: event.status, at: new Date(Number(event.timestamp) * 1000).toISOString(), createdAt: Date.now() });
  }
}
