import { emitEntityEvent, writeEntityEvent } from "@/lib/automations/events";
import { createHash, randomUUID } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import type { Payment } from "@/lib/messaging/domain-types";
import {
  customerDocumentId,
  documentId,
  money,
  mutateDocument,
  readDocument,
  serverTimestamp,
} from "@/lib/messaging/services/shared";
import { getRuntimeRecordById, mutateRuntimeRecord, mutateRuntimeRecordById, postgresRuntimeMode } from "@/lib/messaging/services/postgres-runtime-records";

export async function getPayment(paymentId: string): Promise<Payment | null> {
  if (postgresRuntimeMode()) return getRuntimeRecordById<Payment & Record<string, unknown>>("payments", documentId(paymentId));
  return readDocument<Payment>(
    adminDb.collection("payments").doc(documentId(paymentId)),
  );
}

export async function createPendingPayment({
  businessId,
  customerPhone,
  amount,
  referenceType,
  referenceId,
  idempotencyKey,
}: {
  businessId: string;
  customerPhone: string;
  amount: number;
  referenceType: Payment["referenceType"];
  referenceId: string;
  idempotencyKey?: string;
}): Promise<Payment> {
  customerDocumentId(businessId, customerPhone);
  documentId(referenceId);
  if (!["order", "booking"].includes(referenceType))
    throw new Error("Invalid payment reference type");
  const normalizedAmount = money(amount);
  if (normalizedAmount <= 0) throw new Error("Payment amount must be positive");
  if (postgresRuntimeMode()) {
    const id = idempotencyKey === undefined ? randomUUID() : `pending_${createHash("sha256").update(JSON.stringify([businessId, idempotencyKey])).digest("hex")}`;
    return mutateRuntimeRecord<Payment & Record<string, unknown>>("payments", businessId, id, current => {
      if (current) {
        if (current.customerPhone !== customerPhone || current.amount !== normalizedAmount || current.referenceType !== referenceType || current.referenceId !== referenceId) throw new Error("Payment idempotency key does not match payment details");
        return current;
      }
      const now = Timestamp.now();
      return { id, businessId, customerPhone, amount: normalizedAmount, currency: "INR", provider: "razorpay", providerPaymentId: null, referenceType, referenceId, status: "pending", failureReason: null, createdAt: now, updatedAt: now };
    });
  }
  const ref =
    idempotencyKey === undefined
      ? adminDb.collection("payments").doc()
      : adminDb.collection("payments").doc(
          `pending_${createHash("sha256")
            .update(JSON.stringify([businessId, idempotencyKey]))
            .digest("hex")}`,
        );
  const now = serverTimestamp();
  const data: Omit<Payment, "id"> = {
    businessId,
    customerPhone,
    amount: normalizedAmount,
    currency: "INR",
    provider: "razorpay",
    providerPaymentId: null,
    referenceType,
    referenceId,
    status: "pending",
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
  if (idempotencyKey === undefined) {
    await ref.create(data);
    return { ...data, id: ref.id };
  }
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const existing = snapshot.data() as Omit<Payment, "id">;
      if (
        existing.businessId !== businessId ||
        existing.customerPhone !== customerPhone ||
        existing.amount !== normalizedAmount ||
        existing.referenceType !== referenceType ||
        existing.referenceId !== referenceId
      ) {
        throw new Error(
          "Payment idempotency key does not match payment details",
        );
      }
      return { ...existing, id: ref.id };
    }
    transaction.create(ref, data);
    return { ...data, id: ref.id };
  });
}

export async function markPaymentPaid({
  paymentId,
  providerPaymentId,
}: {
  paymentId: string;
  providerPaymentId?: string;
}): Promise<Payment> {
  if (postgresRuntimeMode()) {
    const result = await mutateRuntimeRecordById<Payment & Record<string, unknown>>("payments", documentId(paymentId), current => {
      if (current.status === "refunded") throw new Error("Cannot mark a refunded payment paid");
      if (current.providerPaymentId && providerPaymentId && current.providerPaymentId !== providerPaymentId) throw new Error("Provider payment ID does not match");
      return { ...current, status: "paid", providerPaymentId: providerPaymentId ?? current.providerPaymentId, failureReason: null, ...(current.status !== "paid" ? { automationRevision: (current.automationRevision ?? 0) + 1 } : {}), updatedAt: Timestamp.now() };
    });
    if (result.previous.status !== "paid") await emitEntityEvent("payment.completed", result.current);
    return result.current;
  }
  return mutateDocument<Payment>(
    adminDb.collection("payments").doc(documentId(paymentId)),
    (current) => {
      if (current.status === "refunded")
        throw new Error("Cannot mark a refunded payment paid");
      if (
        current.providerPaymentId &&
        providerPaymentId &&
        current.providerPaymentId !== providerPaymentId
      )
        throw new Error("Provider payment ID does not match");
      return {
        status: "paid",
        providerPaymentId: providerPaymentId ?? current.providerPaymentId,
        failureReason: null,
        ...(current.status !== "paid"
          ? { automationRevision: (current.automationRevision ?? 0) + 1 }
          : {}),
      };
    },
    async (tx, previous, updated) => {
      if (previous.status !== "paid")
        await writeEntityEvent(tx, "payment.completed", updated);
    },
  );
}

export async function markPaymentFailed({
  paymentId,
  reason,
}: {
  paymentId: string;
  reason?: string;
}): Promise<Payment> {
  if (postgresRuntimeMode()) return (await mutateRuntimeRecordById<Payment & Record<string, unknown>>("payments", documentId(paymentId), current => {
    if (current.status === "paid" || current.status === "refunded") throw new Error("Cannot fail a settled payment");
    return { ...current, status: "failed", failureReason: reason ?? null, updatedAt: Timestamp.now() };
  })).current;
  return mutateDocument<Payment>(
    adminDb.collection("payments").doc(documentId(paymentId)),
    (current) => {
      if (current.status === "paid" || current.status === "refunded")
        throw new Error("Cannot fail a settled payment");
      return { status: "failed", failureReason: reason ?? null };
    },
  );
}
