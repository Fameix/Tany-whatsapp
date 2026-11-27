import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import type { ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { classifyTenant } from "./tenant-classification";
import { isProductTestBusiness, productTestTenants } from "./product-test-tenants";
import { isConfirmedStagingDatabase } from "./staging-environment";
import type { AdminBusiness } from "./types";

export type ProductReader = {
  execute<T extends Record<string, unknown>>(query: SQL): PromiseLike<{ rows: T[] }>;
};

/** Classify the product's tenants before loading any operational records. */
export async function listProductTenants(products: readonly ActiveTanyVertical[], db: ProductReader = postgresDb(), includeTestData = false) {
  const filter = sql.join(products.map(product => sql`${product}`), sql`, `);
  const { rows } = await db.execute<{
    id: string;
    legacy_business_id: string;
    name: string;
    vertical: ActiveTanyVertical;
    status: string;
    whatsapp_phone_number_id: string | null;
    settings: AdminBusiness["settings"];
  }>(sql`
    select id, legacy_business_id, name, vertical, status, whatsapp_phone_number_id, settings
    from messaging_businesses
    where vertical in (${filter})
    order by name, legacy_business_id
  `);
  const allowTest = includeTestData && isConfirmedStagingDatabase();
  return rows.flatMap<(typeof rows)[number] & { kind: "test" | "live" }>(row => {
    const id = row.legacy_business_id;
    const kind = classifyTenant({ id, settings: row.settings });
    if (/^(phase\d+|demo)-/.test(id)) return [];
    if (isProductTestBusiness(id)) {
      return allowTest && kind === "test" && productTestTenants[row.vertical]?.businessId === id
        ? [{ ...row, kind: "test" as const }] : [];
    }
    return kind === "live" ? [{ ...row, kind: "live" as const }] : [];
  });
}

export async function listProductProfiles(product: ActiveTanyVertical, includeTestData = false): Promise<AdminBusiness[]> {
  return (await listProductTenants([product], undefined, includeTestData)).map(row => ({
    id: row.legacy_business_id,
    name: row.name,
    vertical: row.vertical,
    active: row.status === "active",
    whatsappPhoneNumberId: row.whatsapp_phone_number_id ?? "",
    settings: row.settings ?? {},
  }));
}
