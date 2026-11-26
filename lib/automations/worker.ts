import { eventKey } from "@/lib/automations/events";
import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  runAutomationEvent,
  resumeAutomationRunForBusiness,
} from "@/lib/automations/automation-engine";
import { automationPersistence } from "@/lib/automations/persistence";
import {
  validateAutomation,
  type AutomationEvent,
} from "@/lib/automations/model";
import {
  customerDocumentId,
  documentId,
} from "@/lib/messaging/services/shared";
import { listRuntimeRecords, postgresRuntimeMode } from "@/lib/messaging/services/postgres-runtime-records";
/** Invoke per business from a trusted scheduler. Work is bounded per invocation. */
export async function processAutomationWork(businessId: string) {
  documentId(businessId);
  const repository = automationPersistence();
  const queued = await repository.list("automation_events", businessId, "pending");
  for (const row of queued.slice(0, 50)) {
    const event = row as AutomationEvent;
    try {
      const automationIds = row.automationIds;
      if (Array.isArray(automationIds)) {
        for (const id of automationIds) await runAutomationEvent(event, id);
      } else await runAutomationEvent(event);
      await repository.update("automation_events", businessId, row.id, { status: "processed", completedAt: new Date().toISOString() });
    } catch {
      await repository.update("automation_events", businessId, row.id, {
        status: "failed",
        error: "Event validation failed; review required",
        completedAt: new Date().toISOString(),
      });
    }
  }
  const millis = (value: unknown) => value instanceof Timestamp ? value.toMillis() : value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : 0;
  const waiting = await repository.list("automation_runs", businessId, "waiting");
  for (const row of waiting.filter(run => millis(run.resumeAt) <= Date.now()).slice(0, 50)) await resumeAutomationRunForBusiness(businessId, row.id);
  const interrupted = await repository.list("automation_runs", businessId, "running");
  for (const row of interrupted.filter(run => Date.now() - millis(run.startedAt) > 900000).slice(0, 50)) {
    const current = await repository.get("automation_runs", businessId, row.id);
    if (current?.status === "running") await repository.update("automation_runs", businessId, row.id, {
      status: "failed", error: "Worker interrupted. Manual review required; no automatic resend.", completedAt: new Date().toISOString(),
    });
  }
  const rules = await repository.list("automations", businessId, "active");
  const timed = rules.filter((row) =>
    ["schedule.triggered", "conversation.no_reply"].includes(
      (row.trigger as { type?: unknown } | undefined)?.type as string,
    ),
  );
  if (!timed.length) return;
  const conversations = postgresRuntimeMode()
    ? await listRuntimeRecords<Record<string, unknown> & { id: string; businessId: string }>("conversations", businessId).then(rows => ({ docs: rows.map(row => ({ id: row.id, data: () => row })) }))
    : await adminDb.collection("conversations").where("businessId", "==", businessId).get();
  for (const row of timed) {
    const rule = validateAutomation(row);
    if (
      rule.trigger.type === "schedule.triggered" &&
      Date.parse(rule.trigger.at!) > Date.now()
    )
      continue;
    const cursorId = eventKey(businessId, row.id);
    const cursor = String((await repository.get("automation_states", businessId, cursorId))?.lastId ?? "");
    const orderedConversations = [...conversations.docs].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const batch = orderedConversations
      .filter((c) => c.id > cursor)
      .slice(0, 100);
    for (const conversation of batch) {
      const c = conversation.data();
      if (c.status === "handed_off" || !c.customerPhone) continue;
      let anchor = rule.trigger.at!;
      if (rule.trigger.type === "conversation.no_reply") {
        const messages = postgresRuntimeMode()
          ? await listRuntimeRecords<Record<string, unknown> & { id: string; businessId: string }>("messages", businessId).then(rows => ({ docs: rows.filter(m => m.customerPhone === c.customerPhone).map(row => ({ id: row.id, data: () => row })) }))
          : await adminDb.collection("messages").where("businessId", "==", businessId).where("customerPhone", "==", c.customerPhone).get();
        const ordered = messages.docs
          .map((m) => ({ id: m.id, ...m.data() }) as {
                id: string;
                createdAt: unknown;
                direction: unknown;
                source: unknown;
                automationRunId?: string;
                automationId?: string;
              },
          )
          .sort(
            (a, b) =>
              millis(b.createdAt) - millis(a.createdAt),
          );
        const latest = ordered[0];
        // Follow up only after an outgoing message remains unanswered, once per message/rule.
        if (
          !latest ||
          latest.direction !== "outgoing" ||
          !millis(latest.createdAt) ||
          Date.now() - millis(latest.createdAt) <
            rule.trigger.hours! * 3600000
        )
          continue;
        if (latest.source === "automation") {
          const previousRunId = latest.automationRunId ?? latest.automationId;
          if (!previousRunId) continue;
          const previousRun = await repository.get("automation_runs", businessId, documentId(previousRunId));
          if (
            !previousRun ||
            previousRun.businessId !== businessId ||
            previousRun.trigger === "conversation.no_reply"
          )
            continue;
        }
        anchor = latest.id;
      }
      await runAutomationEvent(
        {
          id: `${row.id}:${anchor}:${conversation.id}`,
          type: rule.trigger.type as AutomationEvent["type"],
          businessId,
          customerId: customerDocumentId(businessId, c.customerPhone),
          conversationId: conversation.id,
          timestamp: new Date().toISOString(),
          payload: {},
          source: "scheduler",
        },
        row.id,
      );
    }
    await repository.upsert("automation_states", {
      id: cursorId, businessId, automationId: row.id, status: "active",
      lastId: batch.length === 100 ? batch.at(-1)!.id : "",
      updatedAt: new Date().toISOString(),
    });
  }
}
