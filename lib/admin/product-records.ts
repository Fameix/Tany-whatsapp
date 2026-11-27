import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import type { ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { listProductTenants, type ProductReader } from "./product-scope";

export type ProductRecordSection = "orders" | "delivery" | "test-drives" | "vehicles" | "products";
const sections: Record<ProductRecordSection, ActiveTanyVertical[]> = {
  orders: ["eats", "retail"],
  delivery: ["eats"],
  "test-drives": ["motos"],
  vehicles: ["motos"],
  products: ["retail"],
};

export async function listProductRecords(product: ActiveTanyVertical, section: ProductRecordSection, db: ProductReader = postgresDb(), includeTestData = false) {
  if (!sections[section].includes(product)) return [];
  const tenants = await listProductTenants([product], db, includeTestData);
  const ids = JSON.stringify(tenants.map(tenant => tenant.id));
  const scope = sql`
    with scope as (
      select b.id, b.legacy_business_id, b.name
      from messaging_businesses b
      join jsonb_array_elements_text(${ids}::jsonb) tenant(id) on b.id = tenant.id::uuid
      where b.vertical = ${product}
    )
  `;
  const catalog = section === "vehicles" || section === "products";
  const query = catalog ? sql`
    select c.id, b.legacy_business_id as "businessId", b.name as business,
      left(c.name, 120) as name, case when c.available then 'Available' else 'Unavailable' end as status
    from messaging_catalog_items c join scope b on b.id = c.messaging_business_id
    where c.type = ${section === "vehicles" ? "vehicle" : "product"}
    order by c.updated_at desc, c.id, b.legacy_business_id
  ` : sql`
    select r.legacy_id as id, b.legacy_business_id as "businessId", b.name as business,
      ${section === "test-drives" ? sql`left(nullif(r.data->>'resourceName', ''), 120)` : sql`null`} as name,
      left(r.data->>'status', 40) as status
    from messaging_runtime_records r join scope b on b.id = r.messaging_business_id
    where r.collection = ${section === "test-drives" ? "bookings" : "orders"}
      ${section === "test-drives" ? sql`and r.data->>'serviceId' = 'test_drive'` : sql``}
      ${section === "delivery" ? sql`and r.data->>'status' in ('out_for_delivery', 'delivered')` : sql``}
    order by r.updated_at desc, r.legacy_id, b.legacy_business_id
  `;
  const { rows } = await db.execute<{ id: string; businessId: string; business: string; name: string | null; status: string | null }>(sql`${scope} ${query} limit 101`);
  return rows;
}
