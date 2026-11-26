import "server-only";
import nextEnv from "@next/env";
import { adminDb } from "@/lib/firebase-admin";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { postgresContactProjection } from "@/lib/data/postgres-contact-privacy";
import type { TenantRow } from "@/lib/data/types";

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging") throw new Error("Backfill requires MESSAGING_POSTGRES_TARGET=staging.");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required.");
  const target = new URL(raw);
  if (/prod|production|live/i.test(`${target.hostname}${target.pathname}`)) throw new Error("Production database target is forbidden.");
  const businessId = "demo-retail";
  const repository = new PostgresMessagingRepository();
  if (!await repository.getBusiness(businessId)) throw new Error("demo-retail must be seeded in staging Postgres first.");
  const collections = ["customers", "orders", "payments", "bookings", "conversations", "messages", "cart_events", "campaigns", "message_delivery_events"] as const;
  const counts: Record<string, number> = {};
  for (const collection of collections) {
    const snapshot = await adminDb.collection(collection).where("businessId", "==", businessId).get();
    counts[collection] = snapshot.size;
    for (const doc of snapshot.docs) {
      const data = { ...doc.data(), id: doc.id, businessId } as TenantRow;
      await repository.putRuntimeRecord(collection, data);
      if (collection === "customers" && typeof data.phone === "string") {
        const privacy = postgresContactProjection(data.phone);
        await repository.mirrorContact({ id: doc.id, businessId, customerId: doc.id, phoneEnc: privacy.phoneEnc, phoneHash: privacy.phoneHash, profileName: typeof data.name === "string" ? data.name : "" });
      } else if (collection === "conversations") {
        await repository.mirrorConversation({ id: doc.id, businessId, contactId: doc.id, vertical: String(data.vertical ?? ""), state: String(data.state ?? "start"), status: String(data.status ?? "active"), handoffStatus: data.status === "handed_off" ? "human" : "bot", context: data.context ?? {}, lastIncomingText: String(data.lastIncomingText ?? ""), pendingReply: typeof data.pendingReply === "string" ? data.pendingReply : null });
      } else if (collection === "messages" && typeof data.messageId === "string") {
        await repository.mirrorMessage(data);
      }
    }
  }
  const prefs = await adminDb.collection("businesses").doc(businessId).collection("whatsappOperations").doc("config").get();
  counts.whatsappOperations = prefs.exists ? 1 : 0;
  if (prefs.exists) await repository.putRuntimeRecord("whatsappOperations", { ...prefs.data(), id: "config", businessId } as TenantRow);
  console.log(JSON.stringify({ businessId, counts }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "runtime backfill failed"); process.exitCode = 1; });
