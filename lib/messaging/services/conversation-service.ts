import { writeEntityEvent } from "@/lib/automations/events";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  mergeConversationContext,
  clearConversationContext,
} from "@/lib/messaging/context";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import type {
  Conversation,
  ConversationContext,
  ConversationStatus,
} from "@/lib/messaging/domain-types";
import type { TanyVertical } from "@/lib/messaging/types";
import {
  assertVertical,
  customerDocumentId,
  definedFields,
  readDocument,
  serverTimestamp,
} from "@/lib/messaging/services/shared";
import { databaseMode, postgresShadowWrite } from "@/lib/data/repository";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { isTanyVertical } from "@/lib/messaging/vertical-config";
import { putRuntimeRecord } from "@/lib/messaging/services/postgres-runtime-records";

async function mirrorConversation(conversation: Conversation) {
  if (postgresRuntimeReads()) {
    await putRuntimeRecord("conversations", { id: conversation.id, businessId: conversation.businessId, customerPhone: conversation.customerPhone, vertical: conversation.vertical, state: conversation.state, status: conversation.status, context: conversation.context, lastIncomingText: conversation.lastIncomingText, pendingReply: conversation.pendingReply, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt });
    return;
  }
  await postgresShadowWrite("conversation", {
    id: conversation.id,
    businessId: conversation.businessId,
    contactId: conversation.id,
    vertical: conversation.vertical,
    state: conversation.state,
    status: conversation.status,
    handoffStatus: conversation.status === "handed_off" ? "human" : "bot",
    context: conversation.context,
    lastIncomingText: conversation.lastIncomingText,
    pendingReply: conversation.pendingReply,
  });
}

const postgresRuntimeReads = () => {
  const mode = databaseMode();
  return mode === "dual-write" || mode === "postgres";
};
const conversationStatuses = new Set<ConversationStatus>(["active", "waiting_customer", "waiting_payment", "completed", "cancelled", "handed_off"]);

function postgresConversation(row: Record<string, unknown>, businessId: string, customerPhone: string): Conversation {
  const vertical = typeof row.vertical === "string" && isTanyVertical(row.vertical) ? row.vertical : null;
  const status = typeof row.status === "string" && conversationStatuses.has(row.status as ConversationStatus) ? row.status as ConversationStatus : null;
  const context = row.context && typeof row.context === "object" && !Array.isArray(row.context) ? row.context as ConversationContext : null;
  const handoffStatus = typeof row.handoff_status === "string" ? row.handoff_status : "";
  if (!vertical || !status || !context || typeof row.state !== "string" || !row.state ||
      (status === "handed_off" ? handoffStatus !== "human" : handoffStatus !== "bot")) {
    throw new Error("POSTGRES_CONVERSATION_INCONSISTENT");
  }
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date();
  const updatedAt = row.updated_at instanceof Date ? row.updated_at : createdAt;
  return {
    id: customerDocumentId(businessId, customerPhone), businessId, customerPhone, vertical,
    state: row.state, status, context,
    lastIncomingText: typeof row.last_incoming_text === "string" ? row.last_incoming_text : "",
    pendingReply: typeof row.pending_reply === "string" ? row.pending_reply : null,
    createdAt: Timestamp.fromDate(createdAt), updatedAt: Timestamp.fromDate(updatedAt),
  };
}

async function postgresConversationLookup(key: ConversationKey): Promise<Conversation | null> {
  try {
    const row = await new PostgresMessagingRepository().getRuntimeConversation(key.businessId, customerDocumentId(key.businessId, key.customerPhone));
    return row ? postgresConversation(row, key.businessId, key.customerPhone) : null;
  } catch (error) {
    console.warn("[POSTGRES_CONVERSATION_LOOKUP_FAILED]", { businessId: key.businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
    throw error;
  }
}

type ConversationKey = { businessId: string; customerPhone: string };
const reference = ({ businessId, customerPhone }: ConversationKey) =>
  adminDb
    .collection("conversations")
    .doc(customerDocumentId(businessId, customerPhone));

export async function getConversation(
  key: ConversationKey,
): Promise<Conversation | null> {
  if (postgresRuntimeReads()) return postgresConversationLookup(key);
  return readDocument<Conversation>(reference(key));
}

export async function getOrCreateConversation({
  businessId,
  customerPhone,
  vertical,
}: ConversationKey & { vertical: TanyVertical }): Promise<Conversation> {
  assertVertical(vertical);
  if (postgresRuntimeReads()) {
    const existing = await postgresConversationLookup({ businessId, customerPhone });
    if (existing) {
      if (existing.vertical !== vertical) throw new Error("Conversation vertical does not match business");
      return existing;
    }
    const now = Timestamp.now();
    const created: Conversation = { id: customerDocumentId(businessId, customerPhone), businessId, customerPhone, vertical, state: verticalConfig[vertical].startState, status: "active", context: {}, lastIncomingText: "", pendingReply: null, createdAt: now, updatedAt: now };
    await new PostgresMessagingRepository().mirrorConversation({ id: created.id, businessId, contactId: created.id, vertical, state: created.state, status: created.status, handoffStatus: "bot", context: created.context, lastIncomingText: "", pendingReply: null });
    await mirrorConversation(created);
    return created;
  }
  const ref = reference({ businessId, customerPhone });
  const conversation = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.data();
    if (existing?.vertical && existing.vertical !== vertical)
      throw new Error("Conversation vertical does not match business");
    const now = serverTimestamp();
    // Backfill old webhook documents without resetting their state or context.
    const data: Omit<Conversation, "id"> = {
      businessId,
      customerPhone,
      vertical,
      state: existing?.state ?? verticalConfig[vertical].startState,
      status: existing?.status ?? "active",
      context: existing?.context ?? {},
      lastIncomingText: existing?.lastIncomingText ?? "",
      pendingReply: existing?.pendingReply ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing?.updatedAt ?? now,
    };
    if (!snapshot.exists)
      await writeEntityEvent(transaction, "conversation.started", {
        ...data,
        id: ref.id,
      });
    transaction.set(ref, data, { merge: true });
    return { ...data, id: ref.id };
  });
  await mirrorConversation(conversation);
  return conversation;
}

export type ConversationUpdate = ConversationKey & {
  state: string;
  status?: ConversationStatus;
  context?: ConversationContext;
  lastIncomingText?: string;
  pendingReply?: string | null;
};

export async function updateConversationState({
  businessId,
  customerPhone,
  state,
  status,
  context,
  lastIncomingText,
  pendingReply,
}: ConversationUpdate): Promise<Conversation> {
  if (postgresRuntimeReads()) {
    const current = await postgresConversationLookup({ businessId, customerPhone });
    if (!current) throw new Error("POSTGRES_CONVERSATION_NOT_FOUND");
    const conversation: Conversation = {
      ...current, state, status: status ?? current.status,
      lastIncomingText: lastIncomingText ?? current.lastIncomingText,
      pendingReply: pendingReply === undefined ? current.pendingReply : pendingReply,
      context: context === undefined ? current.context : mergeConversationContext(current.context, context),
      updatedAt: serverTimestamp(),
    };
    await new PostgresMessagingRepository().mirrorConversation({ id: conversation.id, businessId, contactId: conversation.id, vertical: conversation.vertical, state: conversation.state, status: conversation.status, handoffStatus: conversation.status === "handed_off" ? "human" : "bot", context: conversation.context, lastIncomingText: conversation.lastIncomingText, pendingReply: conversation.pendingReply });
    await mirrorConversation(conversation);
    return conversation;
  }
  const { mutateDocument } = await import("@/lib/messaging/services/shared");
  const conversation = await mutateDocument<Conversation>(
    reference({ businessId, customerPhone }),
    (current) =>
      definedFields({
        state,
        status,
        lastIncomingText,
        pendingReply,
        context:
          context === undefined
            ? undefined
            : mergeConversationContext(current.context ?? {}, context),
      }),
  );
  await mirrorConversation(conversation);
  return conversation;
}

export async function resetConversation(key: ConversationKey): Promise<Conversation> {
  if (postgresRuntimeReads()) {
    const current = await postgresConversationLookup(key);
    if (!current) throw new Error("POSTGRES_CONVERSATION_NOT_FOUND");
    const conversation: Conversation = { ...current, state: verticalConfig[current.vertical].startState, status: "active", context: clearConversationContext(), lastIncomingText: "", pendingReply: null, updatedAt: serverTimestamp() };
    await new PostgresMessagingRepository().mirrorConversation({ id: conversation.id, businessId: key.businessId, contactId: conversation.id, vertical: conversation.vertical, state: conversation.state, status: conversation.status, handoffStatus: "bot", context: conversation.context, lastIncomingText: "", pendingReply: null });
    await mirrorConversation(conversation);
    return conversation;
  }
  const { mutateDocument } = await import("@/lib/messaging/services/shared");
  const conversation = await mutateDocument<Conversation>(reference(key), (current) => {
    assertVertical(current.vertical);
    return {
      state: verticalConfig[current.vertical].startState,
      status: "active",
      context: clearConversationContext(),
      lastIncomingText: "",
      pendingReply: null,
    };
  });
  await mirrorConversation(conversation);
  return conversation;
}
