import { emitEntityEvent, writeEntityEvent } from "@/lib/automations/events";
import { randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { mergeConversationContext } from "@/lib/messaging/context";
import type { Booking, BookingStatus } from "@/lib/messaging/domain-types";
import type { TanyVertical } from "@/lib/messaging/types";
import {
  assertVertical,
  customerDocumentId,
  definedFields,
  documentId,
  money,
  mutateDocument,
  readDocument,
  serverTimestamp,
} from "@/lib/messaging/services/shared";
import { getRuntimeRecordById, mutateRuntimeRecordById, postgresRuntimeMode, putRuntimeRecord } from "@/lib/messaging/services/postgres-runtime-records";

export type BookingUpdate = Partial<
  Pick<
    Booking,
    | "serviceId"
    | "serviceName"
    | "staffId"
    | "staffName"
    | "resourceId"
    | "resourceName"
    | "bookingDate"
    | "startTime"
    | "endTime"
    | "amount"
    | "status"
    | "paymentId"
    | "metadata"
  >
>;
const reference = (id: string) =>
  adminDb.collection("bookings").doc(documentId(id));

export async function createDraftBooking({
  businessId,
  customerPhone,
  vertical,
  reuseConversationDraft = false,
}: {
  businessId: string;
  customerPhone: string;
  vertical: TanyVertical;
  reuseConversationDraft?: boolean;
}): Promise<Booking> {
  const conversationId = customerDocumentId(businessId, customerPhone);
  assertVertical(vertical);
  if (postgresRuntimeMode()) {
    const now = Timestamp.now(); const id = randomUUID();
    const created: Booking = { id, businessId, customerPhone, vertical, serviceId: null, serviceName: null, staffId: null, staffName: null, resourceId: null, resourceName: null, bookingDate: null, startTime: null, endTime: null, amount: 0, currency: "INR", status: "draft", paymentId: null, metadata: {}, createdAt: now, updatedAt: now };
    if (reuseConversationDraft) {
      const { getConversation, updateConversationState } = await import("@/lib/messaging/services/conversation-service");
      const conversation = await getConversation({ businessId, customerPhone });
      if (!conversation || conversation.vertical !== vertical) throw new Error("Booking conversation not found or vertical does not match");
      const existingId = conversation.context.bookingId;
      if (typeof existingId === "string") {
        const existing = await getRuntimeRecordById<Booking & Record<string, unknown>>("bookings", existingId);
        if (!existing || existing.businessId !== businessId || existing.customerPhone !== customerPhone || existing.vertical !== vertical) throw new Error("Conversation booking does not match customer and business");
        return existing;
      }
      await putRuntimeRecord("bookings", created);
      await updateConversationState({ businessId, customerPhone, state: conversation.state, context: mergeConversationContext(conversation.context, { bookingId: id }) });
    } else await putRuntimeRecord("bookings", created);
    await emitEntityEvent("booking.created", created);
    return created;
  }
  const ref = adminDb.collection("bookings").doc();
  const now = serverTimestamp();
  const data: Omit<Booking, "id"> = {
    businessId,
    customerPhone,
    vertical,
    serviceId: null,
    serviceName: null,
    staffId: null,
    staffName: null,
    resourceId: null,
    resourceName: null,
    bookingDate: null,
    startTime: null,
    endTime: null,
    amount: 0,
    currency: "INR",
    status: "draft",
    paymentId: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
  if (!reuseConversationDraft) {
    const created = { ...data, id: ref.id };
    await adminDb.runTransaction(async (tx) => {
      await writeEntityEvent(tx, "booking.created", created);
      tx.create(ref, data);
    });
    return created;
  }
  // Opt-in atomic linking prevents two simultaneous messages creating two drafts.
  // The existing independent-draft API remains unchanged for other callers.
  const conversationRef = adminDb
    .collection("conversations")
    .doc(conversationId);
  const created = await adminDb.runTransaction(async (transaction) => {
    const conversation = await transaction.get(conversationRef);
    const conversationData = conversation.data();
    if (!conversation.exists || conversationData?.vertical !== vertical)
      throw new Error(
        "Booking conversation not found or vertical does not match",
      );
    const context = mergeConversationContext(
      {},
      conversationData.context ?? {},
    );
    if (typeof context.bookingId === "string") {
      const existing = await transaction.get(reference(context.bookingId));
      const existingData = existing.data();
      if (
        !existingData ||
        existingData.businessId !== businessId ||
        existingData.customerPhone !== customerPhone ||
        existingData.vertical !== vertical
      ) {
        throw new Error(
          "Conversation booking does not match customer and business",
        );
      }
      return { ...existingData, id: existing.id } as Booking;
    }
    await writeEntityEvent(transaction, "booking.created", {
      ...data,
      id: ref.id,
    });
    transaction.create(ref, data);
    transaction.update(conversationRef, {
      context: mergeConversationContext(context, { bookingId: ref.id }),
      updatedAt: now,
    });
    return { ...data, id: ref.id };
  });
  return created;
}

export async function updateBooking({
  bookingId,
  data,
}: {
  bookingId: string;
  data: BookingUpdate;
}): Promise<Booking> {
  if (postgresRuntimeMode()) {
    const result = await mutateRuntimeRecordById<Booking & Record<string, unknown>>("bookings", documentId(bookingId), current => ({ ...current, ...definedFields({ serviceId: data.serviceId, serviceName: data.serviceName, staffId: data.staffId, staffName: data.staffName, resourceId: data.resourceId, resourceName: data.resourceName, bookingDate: data.bookingDate, startTime: data.startTime, endTime: data.endTime, status: data.status, paymentId: data.paymentId, amount: data.amount === undefined ? undefined : money(data.amount), metadata: data.metadata === undefined ? undefined : mergeConversationContext(current.metadata, data.metadata), ...(data.status && data.status !== current.status ? { automationRevision: (current.automationRevision ?? 0) + 1 } : {}) }), updatedAt: Timestamp.now() } as Booking & Record<string, unknown>));
    if (result.previous.status !== result.current.status) await emitEntityEvent("booking.status.changed", result.current, { previousStatus: result.previous.status });
    return result.current;
  }
  const {
    serviceId,
    serviceName,
    staffId,
    staffName,
    resourceId,
    resourceName,
    bookingDate,
    startTime,
    endTime,
    amount,
    status,
    paymentId,
    metadata,
  } = data;
  return mutateDocument<Booking>(
    reference(bookingId),
    (current) =>
      definedFields({
        serviceId,
        serviceName,
        staffId,
        staffName,
        resourceId,
        resourceName,
        bookingDate,
        startTime,
        endTime,
        status,
        paymentId,
        amount: amount === undefined ? undefined : money(amount),
        metadata:
          metadata === undefined
            ? undefined
            : mergeConversationContext(current.metadata, metadata),
        ...(status && status !== current.status
          ? { automationRevision: (current.automationRevision ?? 0) + 1 }
          : {}),
      }),
    async (tx, previous, updated) => {
      if (previous.status !== updated.status)
        await writeEntityEvent(tx, "booking.status.changed", updated, {
          previousStatus: previous.status,
        });
    },
  );
}

export async function getBooking(bookingId: string): Promise<Booking | null> {
  if (postgresRuntimeMode()) return getRuntimeRecordById<Booking & Record<string, unknown>>("bookings", documentId(bookingId));
  return readDocument<Booking>(reference(bookingId));
}
export function setBookingStatus({
  bookingId,
  status,
}: {
  bookingId: string;
  status: BookingStatus;
}): Promise<Booking> {
  return updateBooking({ bookingId, data: { status } });
}
