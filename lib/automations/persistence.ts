import "server-only";
import { adminDb } from "@/lib/firebase-admin";
import { databaseMode } from "@/lib/data/repository";
import type { TenantRow } from "@/lib/data/types";
import { PostgresAutomationPersistence, type AutomationTable } from "@/lib/automations/postgres-persistence";

export interface AutomationPersistence {
  findRun(id: string): Promise<TenantRow | null>;
  list(table: AutomationTable, businessId: string, status?: string): Promise<TenantRow[]>;
  get(table: AutomationTable, businessId: string, id: string): Promise<TenantRow | null>;
  create(table: AutomationTable, row: TenantRow): Promise<boolean>;
  upsert(table: AutomationTable, row: TenantRow): Promise<void>;
  update(table: AutomationTable, businessId: string, id: string, patch: Record<string, unknown>): Promise<TenantRow>;
  delete(table: AutomationTable, businessId: string, id: string): Promise<void>;
}

class FirestoreAutomationPersistence implements AutomationPersistence {
  async findRun(id: string) { const data = (await adminDb.collection("automation_runs").doc(id).get()).data(); return data?.businessId ? { ...data, id, businessId: String(data.businessId) } : null; }
  async list(table: AutomationTable, businessId: string, status?: string) { let query: FirebaseFirestore.Query = adminDb.collection(table).where("businessId", "==", businessId); if (status) query = query.where("status", "==", status); const result = await query.get(); return result.docs.map(doc => ({ ...doc.data(), id: doc.id, businessId })); }
  async get(table: AutomationTable, businessId: string, id: string) { const data = (await adminDb.collection(table).doc(id).get()).data(); return data?.businessId === businessId ? { ...data, id, businessId } : null; }
  async create(table: AutomationTable, row: TenantRow) { try { await adminDb.collection(table).doc(row.id).create(row); return true; } catch (error) { const details = error as { code?: unknown; message?: unknown }; if (details.code === 6 || details.code === "already-exists" || details.message === "Already exists") return false; throw error; } }
  async upsert(table: AutomationTable, row: TenantRow) { await adminDb.collection(table).doc(row.id).set(row, { merge: true }); }
  async update(table: AutomationTable, businessId: string, id: string, patch: Record<string, unknown>) { const current = await this.get(table, businessId, id); if (!current) throw new Error("Automation row not found."); await adminDb.collection(table).doc(id).update(patch); return { ...current, ...patch }; }
  async delete(table: AutomationTable, businessId: string, id: string) { if (!await this.get(table, businessId, id)) throw new Error("Automation row not found."); await adminDb.collection(table).doc(id).delete(); }
}

class DualWriteAutomationPersistence implements AutomationPersistence {
  constructor(private primary: AutomationPersistence, private shadow: AutomationPersistence) {}
  findRun(id: string) { return this.primary.findRun(id); }
  list(table: AutomationTable, businessId: string, status?: string) { return this.primary.list(table, businessId, status); }
  get(table: AutomationTable, businessId: string, id: string) { return this.primary.get(table, businessId, id); }
  private async mirror(operation: () => Promise<unknown>, table: AutomationTable, businessId: string) { try { await operation(); } catch (error) { console.warn("[FIRESTORE_AUTOMATION_SHADOW_FAILED]", { table, businessId, code: error instanceof Error ? error.name : "UNKNOWN" }); } }
  async create(table: AutomationTable, row: TenantRow) { const created = await this.primary.create(table, row); if (created) await this.mirror(() => this.shadow.upsert(table, row), table, row.businessId); return created; }
  async upsert(table: AutomationTable, row: TenantRow) { await this.primary.upsert(table, row); await this.mirror(() => this.shadow.upsert(table, row), table, row.businessId); }
  async update(table: AutomationTable, businessId: string, id: string, patch: Record<string, unknown>) { const row = await this.primary.update(table, businessId, id, patch); await this.mirror(() => this.shadow.upsert(table, row), table, businessId); return row; }
  async delete(table: AutomationTable, businessId: string, id: string) { await this.primary.delete(table, businessId, id); await this.mirror(() => this.shadow.delete(table, businessId, id), table, businessId); }
}

export function postgresAutomationAuthoritative() { const mode = databaseMode(); return mode === "postgres" || mode === "dual-write"; }
export function automationPersistence(): AutomationPersistence { const mode = databaseMode(); const firestore = new FirestoreAutomationPersistence(); if (mode === "postgres") return new PostgresAutomationPersistence(); if (mode === "dual-write") return new DualWriteAutomationPersistence(new PostgresAutomationPersistence(), firestore); return firestore; }
