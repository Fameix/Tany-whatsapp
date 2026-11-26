/** Fixed staging test tenants. Kept free of data-layer imports so the request
 * proxy can use it before rendering. */
export const productTestTenants = {
  retail: { businessId: "test-retail", vertical: "retail" },
  eats: { businessId: "test-eats", vertical: "eats" },
  motos: { businessId: "test-motos", vertical: "motos" },
} as const;

export type ProductTestProduct = keyof typeof productTestTenants;
const testBusinessIds = new Set<string>(Object.values(productTestTenants).map(({ businessId }) => businessId));
export const isProductTestBusiness = (businessId: string) => testBusinessIds.has(businessId);

/** Marks the setup redirect issued by an entry link, so the proxy never bounces back to it. */
export const productTestEntryMarker = "entry";

/** Public entry link that issues the scoped session for a fixed test tenant. */
export function productTestEntryPath(businessId: string) {
  const product = (Object.keys(productTestTenants) as ProductTestProduct[]).find(key => productTestTenants[key].businessId === businessId);
  return product ? `/${product}` : null;
}

/** Product test entry is available only against an explicit, non-production staging Postgres. */
export function productTestStagingMode() {
  const mode = process.env.MESSAGING_DATABASE;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return process.env.MESSAGING_POSTGRES_TARGET === "staging" &&
      (mode === "postgres" || mode === "dual-write") &&
      !/prod|production|live/i.test(`${url.hostname}${url.pathname}`);
  } catch { return false; }
}
