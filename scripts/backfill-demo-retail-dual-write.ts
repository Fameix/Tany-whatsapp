import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

import { adminDb } from "@/lib/firebase-admin";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { postgresContactProjection } from "@/lib/data/postgres-contact-privacy";
import { PostgresAutomationPersistence, type AutomationTable } from "@/lib/automations/postgres-persistence";

const businessId = "demo-retail";
const text = (value: unknown) => typeof value === "string" ? value : "";
const date = (value: { toDate?: () => Date } | undefined) => value?.toDate?.() ?? null;
const plain = (value: unknown): unknown => {
  if (value && typeof value === "object" && "toDate" in value) return (value as { toDate(): Date }).toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, plain(child)]));
  return value;
};

async function main() {
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging")
    throw new Error("Refusing backfill: MESSAGING_POSTGRES_TARGET must be staging.");
  const repository = new PostgresMessagingRepository();
  const automationRepository = new PostgresAutomationPersistence();
  const [contacts, conversations, messages, events, automations, automationEvents, automationRuns, templates, schedulerStates] = await Promise.all([
    adminDb.collection("customers").where("businessId", "==", businessId).get(),
    adminDb.collection("conversations").where("businessId", "==", businessId).get(),
    adminDb.collection("messages").where("businessId", "==", businessId).get(),
    adminDb.collection("message_delivery_events").where("businessId", "==", businessId).get(),
    adminDb.collection("automations").where("businessId", "==", businessId).get(),
    adminDb.collection("automation_events").where("businessId", "==", businessId).get(),
    adminDb.collection("automation_runs").where("businessId", "==", businessId).get(),
    adminDb.collection("templates").where("businessId", "==", businessId).get(),
    adminDb.collection("automation_scheduler_cursors").where("businessId", "==", businessId).get(),
  ]);
  let mirroredContacts = 0, mirroredConversations = 0, mirroredMessages = 0, mirroredEvents = 0;
  for (const doc of contacts.docs) {
    const row = doc.data(); const phone = text(row.phone);
    if (!phone) continue;
    const privacy = postgresContactProjection(phone);
    await repository.mirrorContact({ id: doc.id, businessId, customerId: doc.id, phoneEnc: privacy.phoneEnc, phoneHash: privacy.phoneHash, profileName: text(row.name) });
    mirroredContacts++;
  }
  for (const doc of conversations.docs) {
    const row = doc.data();
    await repository.mirrorConversation({ id: doc.id, businessId, contactId: doc.id, vertical: text(row.vertical), state: text(row.state) || "start", status: text(row.status) || "active", handoffStatus: row.status === "handed_off" ? "human" : "bot", context: row.context ?? {}, lastIncomingText: text(row.lastIncomingText), pendingReply: typeof row.pendingReply === "string" ? row.pendingReply : null, lastIncomingAt: date(row.updatedAt), lastOutgoingAt: null });
    mirroredConversations++;
  }
  for (const doc of messages.docs) {
    const row = doc.data(); const messageId = text(row.messageId);
    if (!messageId || !["incoming", "outgoing"].includes(text(row.direction))) continue;
    await repository.mirrorMessage({ id: doc.id, businessId, messageId, direction: text(row.direction), type: text(row.type) || "text", text: text(row.text), body: text(row.body), processingStatus: text(row.processingStatus) || "pending", attempts: Number(row.attempts) || 0, error: text(row.error), whatsappTimestamp: row.whatsappTimestamp, createdAt: date(row.createdAt) ?? new Date() });
    mirroredMessages++;
  }
  for (const doc of events.docs) {
    const row = doc.data(); const messageId = text(row.messageId); const status = text(row.status);
    if (!messageId || !status) continue;
    await repository.mirrorDeliveryEvent({ id: doc.id, businessId, messageId, status, at: date(row.at)?.toISOString() ?? text(row.at), createdAt: date(row.createdAt) ?? new Date() });
    mirroredEvents++;
  }
  const backfillRows = async (table: AutomationTable, docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    for (const doc of docs) await automationRepository.upsert(table, { ...(plain(doc.data()) as Record<string, unknown>), id: doc.id, businessId });
    return docs.length;
  };
  const [backfilledAutomations, backfilledAutomationEvents, backfilledAutomationRuns, backfilledTemplates, backfilledAutomationStates] = await Promise.all([
    backfillRows("automations", automations.docs),
    backfillRows("automation_events", automationEvents.docs),
    backfillRows("automation_runs", automationRuns.docs),
    backfillRows("templates", templates.docs),
    backfillRows("automation_states", schedulerStates.docs),
  ]);
  console.log(JSON.stringify({ mirroredContacts, mirroredConversations, mirroredMessages, mirroredEvents, backfilledAutomations, backfilledAutomationEvents, backfilledAutomationRuns, backfilledTemplates, backfilledAutomationStates }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Demo Retail dual-write backfill failed."); process.exitCode = 1; });
