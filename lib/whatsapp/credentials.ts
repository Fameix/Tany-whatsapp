import "server-only";
import { GoogleAuth } from "google-auth-library";

const managedPrefix = "TANY_WA_";
const managedSuffix = "_META_TOKEN";
const projectId = () => {
  const configured = process.env.WHATSAPP_TOKEN_SECRET_PROJECT?.trim() || process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCLOUD_PROJECT?.trim();
  if (process.env.MESSAGING_POSTGRES_TARGET === "staging" && !configured)
    throw new Error("Staging WhatsApp secret project must be configured explicitly.");
  return configured || "tany-whatsapp";
};
export function managedTokenSecretName(businessId: string) {
  return `${managedPrefix}${businessId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}${managedSuffix}`;
}
function isManagedSecretName(secretName: string, businessId: string) {
  return secretName === managedTokenSecretName(businessId);
}
/** Legacy credentials are mounted environment variables. Embedded Signup
 * credentials use the deterministic, tenant-bound Google Secret Manager name. */
export function isAllowedTokenSecretName(secretName: string, businessId: string) {
  if (isManagedSecretName(secretName, businessId)) return true;
  const allowed = (process.env.WHATSAPP_TOKEN_SECRET_NAMES ?? "").split(",").map(s => s.trim());
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(secretName) || !allowed.includes(secretName)) return null;
  try {
    const bindings = JSON.parse(process.env.WHATSAPP_TOKEN_SECRET_BINDINGS ?? "{}");
    return bindings[businessId] === secretName;
  } catch { return null; }
}
async function secretManagerAccessToken(secretName: string): Promise<string | null> {
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const client = await auth.getClient();
    const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId())}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
    const response = await client.request<{ payload?: { data?: string } }>({ url, method: "GET" });
    const encoded = response.data?.payload?.data;
    return typeof encoded === "string" ? Buffer.from(encoded, "base64").toString("utf8") : null;
  } catch { return null; }
}
export async function accountAccessToken(secretName: string, businessId: string): Promise<string | null> {
  if (!isAllowedTokenSecretName(secretName, businessId)) return null;
  if (isManagedSecretName(secretName, businessId)) return secretManagerAccessToken(secretName);
  return process.env[secretName] || null;
}

/** Raised when the Embedded Signup token cannot be written to Secret Manager. */
export class CredentialStorageError extends Error {
  constructor(public operation: string, public project: string, public status?: number, public reason?: string) {
    super("Secure credential storage is not available.");
  }
}
/** Google API error fields only; the request body (the token) is never included. */
function googleError(error: unknown) {
  const response = typeof error === "object" && error && "response" in error
    ? (error as { response?: { status?: number; data?: { error?: { status?: string; message?: string } } } }).response : undefined;
  return { status: response?.status, reason: response?.data?.error?.status ?? (error instanceof Error ? error.name : undefined), message: response?.data?.error?.message?.slice(0, 200) };
}

/** Stores an Embedded Signup token without putting it in Firestore, logs or the browser.
 * The workload identity needs Secret Manager secret-version write access. */
export async function storeEmbeddedSignupAccessToken(businessId: string, token: string) {
  const secretName = managedTokenSecretName(businessId);
  if (!/^[A-Za-z0-9._~\-]{20,4096}$/.test(token)) throw new Error("Invalid provider credential.");
  const project = projectId();
  const log = (step: string, details: Record<string, unknown>) => console.info(`[EMBEDDED_SIGNUP] ${step}`, { businessId, project, secretName, ...details });
  let client;
  try { client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient(); }
  catch (error) { log("SECRET_STORE_FAILED", { operation: "credentials", ...googleError(error) }); throw new CredentialStorageError("credentials", project); }
  const base = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}`;
  try {
    await client.request({ url: `${base}/secrets?secretId=${encodeURIComponent(secretName)}`, method: "POST", data: { replication: { automatic: {} } } });
    log("SECRET_CREATED", {});
  } catch (error: unknown) {
    const details = googleError(error);
    if (details.status !== 409) { log("SECRET_STORE_FAILED", { operation: "create-secret", ...details }); throw new CredentialStorageError("create-secret", project, details.status, details.reason); }
  }
  try {
    await client.request({
      url: `${base}/secrets/${encodeURIComponent(secretName)}:addVersion`, method: "POST",
      data: { payload: { data: Buffer.from(token, "utf8").toString("base64") } },
    });
  } catch (error) {
    const details = googleError(error);
    log("SECRET_STORE_FAILED", { operation: "add-version", ...details });
    throw new CredentialStorageError("add-version", project, details.status, details.reason);
  }
  log("SECRET_STORED", {});
  return secretName;
}
