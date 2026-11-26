import "server-only";
import { adminDb } from "@/lib/firebase-admin";
import { customerDocumentId } from "@/lib/messaging/services/shared";
import { databaseMode } from "@/lib/data/repository";
import { listRuntimeRecords } from "@/lib/messaging/services/postgres-runtime-records";

export type RecentRequest = {
  kind: "order" | "booking";
  title: string;
  status: string;
};
/** Private, tenant-scoped history projection shared by linked-customer menus. No IDs, UID or payment data. */
export async function listRecentCustomerRequests(
  businessId: string,
  phone: string,
  kind?: RecentRequest["kind"],
): Promise<RecentRequest[]> {
  customerDocumentId(businessId, phone);
  const collections = kind
    ? [kind === "order" ? "orders" : "bookings"]
    : ["orders", "bookings"];
  const history = await Promise.all(
    collections.map(async (collection) => {
      const postgresMode = databaseMode() === "postgres" || databaseMode() === "dual-write";
      const entries: Array<Record<string, unknown> & { id: string; businessId: string }> = postgresMode
        ? await listRuntimeRecords<Record<string, unknown> & { id: string; businessId: string }>(collection, businessId)
        : (await adminDb.collection(collection).where("businessId", "==", businessId).where("customerPhone", "==", phone).get()).docs.map(doc => ({ ...doc.data(), id: doc.id, businessId } as Record<string, unknown> & { id: string; businessId: string }));
      return entries
        .filter(row => row.businessId === businessId && row.customerPhone === phone)
        .map((row) => {
          const title =
            collection === "bookings"
              ? row.serviceName
              : Array.isArray(row.items)
                ? row.items[0]?.name
                : "Order";
          return {
            kind:
              collection === "orders"
                ? ("order" as const)
                : ("booking" as const),
            title:
              typeof title === "string"
                ? title.slice(0, 100)
                : "Recent request",
            status:
              typeof row.status === "string" &&
              /^[a-z_]{1,30}$/.test(row.status)
                ? row.status
                : "unknown",
            at: typeof row.updatedAt === "string" ? Date.parse(row.updatedAt) || 0 : row.updatedAt instanceof Date ? row.updatedAt.getTime() : (row.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.()?.getTime?.() ?? (typeof row.createdAt === "string" ? Date.parse(row.createdAt) || 0 : 0),
          };
        });
    }),
  );
  return history
    .flat()
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
    .map(({ kind, title, status }) => ({ kind, title, status }));
}
