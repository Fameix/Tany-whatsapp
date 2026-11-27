import "server-only";
import { headers } from "next/headers";
import { verifyIntegrationAccess } from "@/lib/integration/access";
import { isStagingWorker, isStagingWorkerHost } from "./staging-environment";

/** Separate signing keys even when staging and the real gateway share a service secret. */
export function stagingDirectorySigningKey(secret: string) {
  return "tany-whatsapp-staging-directory-v1:" + secret;
}

export async function verifyDirectorySession(secret: string, token: string, requestHost?: string) {
  if (secret.length < 32 || !token) return false;
  const now = Date.now();
  const scope = { kind: "directory" } as const;
  if (await verifyIntegrationAccess(secret, token, scope, now, "tany-dashboard-v1")) return true;
  if (!isStagingWorker()) return false;
  const host = requestHost ?? (await headers()).get("host");
  return isStagingWorkerHost(host) &&
    verifyIntegrationAccess(stagingDirectorySigningKey(secret), token, scope, now, "tany-dashboard-v1");
}
