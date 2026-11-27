const stagingDatabaseHost = "ep-shiny-boat-bifvzzhe.c-5.ap-southeast-1.aws.neon.tech";
const stagingDatabasePooler = "ep-shiny-boat-bifvzzhe-pooler.c-5.ap-southeast-1.aws.neon.tech";
const stagingHost = "tany-whatsapp.tany-8b9.workers.dev";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The target flag alone cannot identify a database. Accept only this staging database and its pooler. */
export function isConfirmedStagingDatabase(env = process.env) {
  if (env.MESSAGING_POSTGRES_TARGET !== "staging" ||
      (env.MESSAGING_DATABASE !== "postgres" && env.MESSAGING_DATABASE !== "dual-write")) return false;
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    return (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      (url.hostname === stagingDatabaseHost || url.hostname === stagingDatabasePooler) &&
      url.pathname === "/neondb" && (!url.port || url.port === "5432") && !url.hash &&
      [...url.searchParams.keys()].every(key => key === "sslmode" || key === "channel_binding");
  } catch {
    return false;
  }
}

function hostname(host: string | null) {
  return host?.toLowerCase().replace(/:\d+$/, "") ?? "";
}

export function isLocalStaging(host: string | null, env = process.env) {
  return env.NODE_ENV === "development" && loopbackHosts.has(hostname(host)) && isConfirmedStagingDatabase(env);
}

export function canIncludeStagingTestData(host: string | null, env = process.env) {
  return isLocalStaging(host, env) ||
    (hostname(host) === stagingHost && isConfirmedStagingDatabase(env));
}

export function stagingWorkspaceUrl(businessId: string) {
  return `https://${stagingHost}/business/${encodeURIComponent(businessId)}`;
}

export function stagingAdminWhatsAppUrl(product: string, businessId: string, profile = false) {
  const root = `https://${stagingHost}/admin/products/${encodeURIComponent(product)}/whatsapp`;
  const id = encodeURIComponent(businessId);
  return profile ? `${root}/${id}/profile` : `${root}?business=${id}`;
}
