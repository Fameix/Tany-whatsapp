import type { DatabaseMode, D1Like, MessagingRepository, TenantRow } from "./types";
import { D1MessagingRepository } from "./d1-repository";
export function databaseMode(value = process.env.MESSAGING_DATABASE): DatabaseMode { return value === "d1" || value === "dual" || value === "postgres" || value === "dual-write" ? value : "firestore"; }
export async function repositoryFor(mode = databaseMode(), d1?: D1Like): Promise<MessagingRepository> {
  if (mode === "d1") { if (!d1) throw new Error("D1 binding is required when MESSAGING_DATABASE=d1."); return new D1MessagingRepository(d1); }
  // This general repository remains Firestore-backed for business/config and
  // other legacy paths. Cutover-owned services select their Postgres adapter
  // explicitly so unrelated Firestore behavior remains unchanged.
  const { FirestoreMessagingRepository } = await import("./firestore-repository");
  return new FirestoreMessagingRepository();
}
/** Select the authoritative repository for final business/config cutover paths. */
export async function runtimeRepositoryFor(mode = databaseMode()): Promise<MessagingRepository | import("./postgres-messaging-repository").PostgresMessagingRepository> {
  if (mode === "postgres" || mode === "dual-write") {
    const { PostgresMessagingRepository } = await import("./postgres-messaging-repository");
    return new PostgresMessagingRepository();
  }
  return repositoryFor(mode);
}
export async function postgresRepositoryFor() {
  const { PostgresMessagingRepository } = await import("./postgres-messaging-repository");
  return new PostgresMessagingRepository();
}
function postgresPersistenceEnabled(mode: DatabaseMode) { return mode === "dual-write" || mode === "postgres"; }
/** Firestore remains authoritative. The Postgres mirror is best-effort and
 * deliberately reports a safe error marker without data or credentials. */
export async function postgresShadowWrite(table: "account" | "message" | "delivery-event" | "template" | "contact" | "conversation", row: TenantRow) {
  if (!postgresPersistenceEnabled(databaseMode())) return;
  await safePostgresMirror(table, row, async () => {
    const { PostgresMessagingRepository } = await import("./postgres-messaging-repository");
    const repository = new PostgresMessagingRepository();
    if (table === "account") await repository.mirrorAccount(row);
    else if (table === "message") await repository.mirrorMessage(row);
    else if (table === "delivery-event") await repository.mirrorDeliveryEvent(row as TenantRow & { messageId: string; status: string });
    else if (table === "contact") await repository.mirrorContact(row);
    else if (table === "conversation") await repository.mirrorConversation(row as TenantRow & { contactId: string });
    else await repository.mirrorTemplate(row);
  });
}
/** Exported for deterministic tests. A mirror failure is observational only:
 * Firestore has already committed before this helper is called. */
export async function safePostgresMirror(table: string, row: TenantRow, write: () => Promise<void>) {
  try {
    await write();
  } catch (error) {
    console.warn("[POSTGRES_DUAL_WRITE_FAILED]", { table, businessId: row.businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
  }
}
/** Firestore stays authoritative in dual mode; this mirrors only already-safe writes. */
export async function shadowWrite(mode: DatabaseMode, d1: D1Like | undefined, table: string, row: TenantRow) {
  if (mode !== "dual" || !d1) return;
  try { await new D1MessagingRepository(d1).upsertTenantRow(table, row); }
  catch (error) {
    // Shadow writes must never impact the Firestore-authoritative request.
    console.warn("[D1_SHADOW_WRITE_FAILED]", { table, businessId: row.businessId, error: error instanceof Error ? error.name : "UnknownError" });
  }
}
