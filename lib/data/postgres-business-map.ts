import "server-only";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalMessagingBusinessRow = { id: unknown; legacy_business_id: unknown };

/** Validates a database lookup result without allowing a caller to select a
 * different local tenant. No environment mapping or external database is used. */
export function localMessagingBusinessId(businessId: string, row: LocalMessagingBusinessRow | undefined): string | null {
  if (!businessId || businessId.includes("/") || !row || row.legacy_business_id !== businessId || typeof row.id !== "string" || !uuid.test(row.id)) return null;
  return row.id;
}
