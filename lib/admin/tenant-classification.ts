/** Which kind of tenant a business is. Only "live" businesses count in product metrics. */
export type TenantKind = "live" | "test" | "demo" | "migration";

const kinds: readonly TenantKind[] = ["live", "test", "demo", "migration"];

/**
 * Classification order:
 * 1. An explicit `settings.tenantKind` on the business (set by provisioning or by a Super Admin).
 * 2. The immutable tenant id prefix that test/demo/migration provisioning has always used
 *    (`test-`, `demo-`, `phase<N>-`). Display names are never used.
 */
export function classifyTenant(business: { id: string; settings?: unknown }): TenantKind {
  const settings = business.settings && typeof business.settings === "object" ? business.settings as Record<string, unknown> : {};
  if (typeof settings.tenantKind === "string" && (kinds as readonly string[]).includes(settings.tenantKind)) return settings.tenantKind as TenantKind;
  if (/^phase\d+-/.test(business.id)) return "migration";
  if (business.id.startsWith("test-")) return "test";
  if (business.id.startsWith("demo-")) return "demo";
  return "live";
}

export const tenantKindLabel: Record<TenantKind, string> = { live: "Live", test: "Test", demo: "Demo", migration: "Migration fixture" };
