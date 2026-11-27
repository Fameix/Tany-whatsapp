/** Canonical tenant entry paths shared by authentication and workspace navigation. */
export function businessWorkspacePath(businessId: string) {
  return `/business/${encodeURIComponent(businessId)}`;
}
