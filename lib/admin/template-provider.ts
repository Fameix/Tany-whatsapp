import "server-only";
import { automationPersistence, postgresAutomationAuthoritative } from "@/lib/automations/persistence";
import { documentId } from "@/lib/messaging/services/shared";
import type { OperationRecord } from "./operations-types";

/** A future Meta adapter must return this same safe, tenant-scoped contract. */
export interface WhatsAppTemplateProvider {
  readonly source: "firestore" | "postgres" | "meta";
  list(scope: {
    businessId: string;
    businessName: string;
  }): Promise<OperationRecord[]>;
}
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";
export const firestoreTemplateProvider: WhatsAppTemplateProvider = {
  get source() { return postgresAutomationAuthoritative() ? "postgres" as const : "firestore" as const; },
  async list({ businessId, businessName }) {
    documentId(businessId);
    const templates = await automationPersistence().list("templates", businessId);
    return templates
      .filter((data) => data.businessId === businessId)
      .map((data) => {
        const updatedAt = data.updatedAt instanceof Date ? data.updatedAt : typeof data.updatedAt === "string" ? new Date(data.updatedAt) : (data.updatedAt as { toDate?(): Date } | undefined)?.toDate?.();
        return {
          id: data.id,
          businessId,
          business: businessName,
          name: text(data.name, 120),
          status: ["approved", "pending", "rejected", "draft"].includes(
            String(data.status),
          )
            ? String(data.status)
            : "draft",
          language: text(data.language, 20),
          category: ["marketing", "utility", "authentication"].includes(
            String(data.category),
          )
            ? String(data.category)
            : "unknown",
          at:
            updatedAt instanceof Date && Number.isFinite(updatedAt.getTime())
              ? updatedAt.toISOString()
              : null,
          body: text(data.body || (Array.isArray(data.components) ? data.components.find((c: { type?: string }) => c.type?.toUpperCase() === "BODY")?.text : ""), 10000),
          template: "",
          audience: "",
          schedule: null,
        };
      });
  },
};
