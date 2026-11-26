import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { databaseMode, postgresShadowWrite, repositoryFor } from "@/lib/data/repository";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { messageClaimsFor } from "@/worker/bindings";
import { d1For } from "@/worker/bindings";
import type { StoredMessage } from "@/lib/messaging/domain-types";
import type { FlowResult } from "@/lib/messaging/types";
import type { ProductSkip } from "@/lib/whatsapp/product-sequence";
import { definedFields, documentId, serverTimestamp } from "@/lib/messaging/services/shared";

type IncomingMessage = Omit<StoredMessage, "createdAt" | "processingStatus" | "direction">;
type MessageClaim = { id: string; token: string; businessId: string; messageId: string; request?: Request };
const postgresRuntimeState = () => {
  const mode = databaseMode();
  return mode === "dual-write" || mode === "postgres";
};
const postgresState = () => new PostgresMessagingRepository();
export function messageDocumentId(messageId: string): string {
  if (!messageId?.trim()) throw new Error("Message ID is required");
  try { return documentId(messageId); }
  catch { return `meta_${createHash("sha256").update(messageId).digest("hex")}`; }
}

/** Atomic reservation prevents two simultaneous Meta deliveries being routed. */
export async function claimIncomingMessage(message: IncomingMessage, request?: Request): Promise<MessageClaim | null> {
  const id = messageDocumentId(message.messageId);
  if (databaseMode() === "d1") {
    if (!request) throw new Error("A Worker request is required for D1 message claiming.");
    const claims = messageClaimsFor(request);
    const stub = claims.get(claims.idFromName(`${message.businessId}:${message.messageId}`));
    const response = await stub.fetch("https://message-claims/claim", { method: "POST", body: JSON.stringify({ action: "claim", businessId: message.businessId, messageId: message.messageId }) });
    if (!response.ok) throw new Error("Message claim coordinator rejected the claim.");
    const result = await response.json() as { claimed: boolean; token?: string };
    if (!result.claimed || !result.token) return null;
    const payload = { ...message, from: message.customerPhone, direction: "incoming", processingStatus: "received", processingToken: result.token, leaseUntil: Date.now() + 300_000, error: null, createdAt: Date.now(), updatedAt: Date.now() };
    try {
      await d1For(request).prepare("INSERT INTO messages (id, business_id, message_id, direction, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, message.businessId, message.messageId, "incoming", JSON.stringify(payload), Date.now()).run();
    } catch (error) {
      // Do not finish the coordinator claim: its lease makes the delivery safely retryable.
      throw new Error(`D1 incoming message persistence failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    return { id, token: result.token, businessId: message.businessId, messageId: message.messageId, request };
  }
  if (postgresRuntimeState()) {
    const token = randomUUID();
    try {
      const claimed = await postgresState().claimRuntimeIncomingMessage({
        ...message, id, token, leaseUntil: new Date(Date.now() + 5 * 60 * 1000),
      });
      if (!claimed) return null;
      return { id, token, businessId: message.businessId, messageId: message.messageId, request };
    } catch (error) {
      console.warn("[POSTGRES_MESSAGE_CLAIM_FAILED]", { businessId: message.businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
      throw error;
    }
  }
  const ref = adminDb.collection("messages").doc(id);
  const token = randomUUID();
  const claim = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.data();
    if (existing) {
      if (existing.businessId !== message.businessId) throw new Error("Message business does not match");
      if (existing.processingStatus === "processed" ||
          (existing.processingStatus === "received" && existing.leaseUntil?.toMillis() > Date.now())) return null;
    } else {
      // Recognize messages saved by the previous auto-ID webhook too.
      const legacy = await transaction.get(adminDb.collection("messages").where("messageId", "==", message.messageId).limit(1));
      if (!legacy.empty) return null;
    }
    transaction.set(ref, {
      ...message, from: message.customerPhone, direction: "incoming",
      createdAt: existing?.createdAt ?? serverTimestamp(), updatedAt: serverTimestamp(),
      processingStatus: "received", processingToken: token,
      leaseUntil: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
      error: null,
    }, { merge: true });
    return { id: ref.id, token, businessId: message.businessId, messageId: message.messageId, request };
  });
  if (claim) await postgresShadowWrite("message", { ...message, id: claim.id, businessId: message.businessId, from: message.customerPhone, direction: "incoming", processingStatus: "received", processingToken: claim.token, leaseUntil: Date.now() + 300_000, createdAt: Date.now() });
  return claim;
}

async function finishClaim(claim: MessageClaim, status: "processed" | "failed", error: string | null) {
  if (databaseMode() === "d1") {
    if (!claim.request) throw new Error("A Worker request is required for D1 message claim completion.");
    const d1 = d1For(claim.request);
    const row = await d1.prepare("SELECT data_json FROM messages WHERE id = ? AND business_id = ?").bind(claim.id, claim.businessId).first<{ data_json: string }>();
    if (!row) throw new Error("Incoming message is unavailable for this business.");
    const data = { ...JSON.parse(row.data_json), processingStatus: status, processingToken: null, leaseUntil: null, error, updatedAt: Date.now() };
    await d1.prepare("UPDATE messages SET data_json = ?, updated_at = ? WHERE id = ? AND business_id = ?").bind(JSON.stringify(data), Date.now(), claim.id, claim.businessId).run();
    const claims = messageClaimsFor(claim.request);
    const stub = claims.get(claims.idFromName(`${claim.businessId}:${claim.messageId}`));
    const response = await stub.fetch("https://message-claims/finish", { method: "POST", body: JSON.stringify({ action: "finish", businessId: claim.businessId, token: claim.token, status, error }) });
    if (!response.ok) throw new Error("Message claim coordinator rejected completion.");
    return;
  }
  if (postgresRuntimeState()) {
    try {
      await postgresState().finishRuntimeIncomingMessage(claim.businessId, claim.messageId, claim.token, status, error);
      return;
    } catch (failure) {
      console.warn("[POSTGRES_MESSAGE_FINISH_FAILED]", { businessId: claim.businessId, code: failure instanceof Error ? failure.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
      throw failure;
    }
  }
  const ref = adminDb.collection("messages").doc(claim.id);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.processingToken !== claim.token) throw new Error("Message processing lease was replaced");
    transaction.update(ref, {
      processingStatus: status, error, updatedAt: serverTimestamp(),
      leaseUntil: FieldValue.delete(), processingToken: FieldValue.delete(),
    });
  });
  await postgresShadowWrite("message", {
    id: claim.id,
    businessId: claim.businessId,
    messageId: claim.messageId,
    direction: "incoming",
    type: "text",
    processingStatus: status,
    error,
    createdAt: Date.now(),
  });
}

export const markMessageProcessed = (claim: MessageClaim) => finishClaim(claim, "processed", null);
export const markMessageFailed = (claim: MessageClaim, error: unknown) => finishClaim(claim, "failed", String(error));

export async function getPreparedMessageResult(claim: MessageClaim): Promise<FlowResult | null> {
  if (databaseMode() === "d1") {
    if (!claim.request) throw new Error("A Worker request is required for D1 message state.");
    return (await repositoryFor("d1", d1For(claim.request))).getTenantRow("messages", claim.businessId, claim.id).then(row => row?.preparedResult as FlowResult ?? null);
  }
  if (postgresRuntimeState()) {
    try { return await postgresState().getRuntimePreparedReply(claim.businessId, claim.messageId) as FlowResult | null; }
    catch (error) { console.warn("[POSTGRES_PREPARED_REPLY_LOOKUP_FAILED]", { businessId: claim.businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" }); throw error; }
  }
  const snapshot = await adminDb.collection("messages").doc(claim.id).get();
  return snapshot.data()?.preparedResult ?? null;
}

export async function getProductSequenceSkips(claim: MessageClaim): Promise<Record<string, ProductSkip>> {
  if (databaseMode() === "d1") {
    if (!claim.request) throw new Error("A Worker request is required for D1 message state.");
    const row = await (await repositoryFor("d1", d1For(claim.request))).getTenantRow("messages", claim.businessId, claim.id); return row?.catalogSequenceSkips as Record<string, ProductSkip> ?? {};
  }
  if (postgresRuntimeState()) return await postgresState().getRuntimeProductSequenceSkips(claim.businessId, claim.messageId) as Record<string, ProductSkip>;
  return (await adminDb.collection("messages").doc(claim.id).get()).data()?.catalogSequenceSkips ?? {};
}
export async function storeProductSequenceSkip(claim: MessageClaim, index: number, skip: ProductSkip) {
  if (databaseMode() === "d1") {
    if (!claim.request) throw new Error("A Worker request is required for D1 message state.");
    const repository = await repositoryFor("d1", d1For(claim.request)); const current = await repository.getTenantRow("messages", claim.businessId, claim.id); if (!current || current.processingToken !== claim.token) throw new Error("Message processing lease was replaced");
    await repository.updateMessageState(claim.businessId, claim.id, { catalogSequenceSkips: { ...(current.catalogSequenceSkips as Record<string, ProductSkip> ?? {}), [String(index)]: skip } }); return;
  }
  if (postgresRuntimeState()) { await postgresState().storeRuntimeProductSequenceSkip(claim.businessId, claim.messageId, claim.token, index, skip); return; }
  const ref = adminDb.collection("messages").doc(claim.id);
  await adminDb.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (data?.processingToken !== claim.token) throw new Error("Message processing lease was replaced");
    tx.update(ref, { catalogSequenceSkips: { ...(data.catalogSequenceSkips ?? {}), [String(index)]: skip } });
  });
}

/** Replaying a failed send must not reinterpret an old button in a newer state. */
export async function storePreparedMessageResult(claim: MessageClaim, result: FlowResult) {
  if (databaseMode() === "d1") {
    if (!claim.request) throw new Error("A Worker request is required for D1 message state.");
    const repository = await repositoryFor("d1", d1For(claim.request)); const current = await repository.getTenantRow("messages", claim.businessId, claim.id); if (!current || current.processingToken !== claim.token) throw new Error("Message processing lease was replaced");
    await repository.updateMessageState(claim.businessId, claim.id, { preparedResult: definedFields(result) }); return;
  }
  if (postgresRuntimeState()) {
    const preparedResult = definedFields(result);
    await postgresState().storeRuntimePreparedReply(claim.businessId, claim.messageId, claim.token, preparedResult);
    return;
  }
  const ref = adminDb.collection("messages").doc(claim.id);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.data()?.processingToken !== claim.token) throw new Error("Message processing lease was replaced");
    transaction.update(ref, { preparedResult: definedFields(result) });
  });
}

const outgoingReference = (incomingMessageId: string) => adminDb.collection("messages").doc(
  `reply_${createHash("sha256").update(incomingMessageId).digest("hex")}`
);

export async function hasStoredReply(incomingMessageId: string, businessId?: string, request?: Request): Promise<boolean> {
  if (databaseMode() === "d1") {
    if (!businessId || !request) throw new Error("businessId and a Worker request are required for D1 reply lookup.");
    return (await repositoryFor("d1", d1For(request))).hasOutgoingReply(businessId, incomingMessageId);
  }
  if (postgresRuntimeState()) {
    if (!businessId) throw new Error("businessId is required for Postgres reply lookup.");
    try { return await postgresState().hasRuntimeOutgoingReply(businessId, incomingMessageId); }
    catch (error) { console.warn("[POSTGRES_OUTGOING_REPLY_LOOKUP_FAILED]", { businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" }); throw error; }
  }
  return (await outgoingReference(incomingMessageId).get()).exists;
}

/** Called after the sender succeeds; the linked record prevents routine resends. */
export async function storeOutgoingMessage({ incomingMessageId, request, ...message }: Omit<StoredMessage, "createdAt" | "direction" | "processingStatus"> & { incomingMessageId: string; request?: Request }) {
  if (databaseMode() === "d1") {
    if (!request) throw new Error("A Worker request is required for D1 outgoing message storage.");
    const id = `reply_${createHash("sha256").update(incomingMessageId).digest("hex")}`;
    await (await repositoryFor("d1", d1For(request))).storeOutgoingReply({ ...message, id, incomingMessageId, businessId: message.businessId, direction: "outgoing", processingStatus: "processed", createdAt: Date.now() });
    return;
  }
  if (postgresRuntimeState()) {
    try {
      const id = `reply_${createHash("sha256").update(incomingMessageId).digest("hex")}`;
      await postgresState().storeRuntimeOutgoingReply({ ...message, id, incomingMessageId, businessId: message.businessId, direction: "outgoing", processingStatus: "processed" });
      return;
    }
    catch (error) { console.warn("[POSTGRES_OUTGOING_REPLY_STORE_FAILED]", { businessId: message.businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" }); throw error; }
  }
  await outgoingReference(incomingMessageId).set({
    ...message, incomingMessageId, direction: "outgoing", processingStatus: "processed", createdAt: serverTimestamp(),
  } satisfies StoredMessage & { incomingMessageId: string });
  await postgresShadowWrite("message", { ...message, id: `reply_${createHash("sha256").update(incomingMessageId).digest("hex")}`, businessId: message.businessId, incomingMessageId, direction: "outgoing", processingStatus: "processed", createdAt: Date.now() });
}
