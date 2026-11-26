import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { automationPersistence, postgresAutomationAuthoritative } from "@/lib/automations/persistence";
import {
  customerDocumentId,
  serverTimestamp,
} from "@/lib/messaging/services/shared";
import type { AutomationEvent } from "@/lib/automations/model";
export const eventKey = (...values: string[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");
/** Durable normalized events; no webhook-specific or vertical-specific logic. */
export async function queueAutomationEvent(event: AutomationEvent) {
  const repository = automationPersistence();
  const active = await repository.list("automations", event.businessId, "active");
  if (!active.length) return;
  await repository.create("automation_events", {
    ...event, id: eventKey(event.businessId, event.id), businessId: event.businessId,
    automationIds: active.map(row => row.id), status: "pending", createdAt: new Date().toISOString(),
  });
}
export async function emitEntityEvent(
  type: AutomationEvent["type"],
  entity: {
    id: string;
    businessId: string;
    customerPhone: string;
    updatedAt?: unknown;
    status?: string;
  },
  payload: Record<string, unknown> = {},
) {
  await queueAutomationEvent({
    id: `${type}:${entity.id}:${entity.status ?? "created"}`,
    type,
    businessId: entity.businessId,
    customerId: customerDocumentId(entity.businessId, entity.customerPhone),
    conversationId: customerDocumentId(entity.businessId, entity.customerPhone),
    entityId: entity.id,
    timestamp: new Date().toISOString(),
    payload: { ...payload, status: entity.status ?? "" },
    source: "domain",
  });
}

/** Called before any writes in a domain transaction: entity and event commit atomically. */
export async function writeEntityEvent(
  tx: FirebaseFirestore.Transaction,
  type: AutomationEvent["type"],
  entity: {
    id: string;
    businessId: string;
    customerPhone: string;
    status?: string;
    automationRevision?: number;
  },
  payload: Record<string, unknown> = {},
) {
  if (postgresAutomationAuthoritative()) {
    await queueAutomationEvent({
      id: `${type}:${entity.id}:${entity.automationRevision ?? 0}:${entity.status ?? "created"}`,
      type, businessId: entity.businessId,
      customerId: customerDocumentId(entity.businessId, entity.customerPhone),
      conversationId: customerDocumentId(entity.businessId, entity.customerPhone),
      entityId: entity.id, timestamp: new Date().toISOString(),
      payload: { ...payload, status: entity.status ?? "" }, source: "domain",
    });
    return;
  }
  const active = await tx.get(
    adminDb
      .collection("automations")
      .where("businessId", "==", entity.businessId)
      .where("status", "==", "active"),
  );
  if (active.empty) return;
  const event: AutomationEvent = {
    id: `${type}:${entity.id}:${entity.automationRevision ?? 0}:${entity.status ?? "created"}`,
    type,
    businessId: entity.businessId,
    customerId: customerDocumentId(entity.businessId, entity.customerPhone),
    conversationId: customerDocumentId(entity.businessId, entity.customerPhone),
    entityId: entity.id,
    timestamp: new Date().toISOString(),
    payload: { ...payload, status: entity.status ?? "" },
    source: "domain",
  };
  const ref = adminDb
    .collection("automation_events")
    .doc(eventKey(event.businessId, event.id));
  if (!(await tx.get(ref)).exists)
    tx.create(ref, {
      ...event,
      automationIds: active.docs.map((d) => d.id),
      status: "pending",
      createdAt: serverTimestamp(),
    });
}
