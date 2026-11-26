import "server-only";

/** Runtime boundary for Secret Manager. Cloudflare can install an adapter backed
 * by a Worker-compatible identity provider without changing token storage or
 * business-facing credential resolution. */
export interface WhatsAppSecretManagerAdapter {
  readSecret(project: string, secretName: string): Promise<string | null>;
  writeSecret(project: string, secretName: string, value: string): Promise<void>;
}
export type WhatsAppSecretManagerAdapterFactory = () => Promise<WhatsAppSecretManagerAdapter>;

export type GoogleAuthClient = {
  request<T = unknown>(options: { url: string; method: string; data?: unknown }): Promise<{ data: T }>;
};
export type GoogleAuthConstructor = new (options: { scopes: string[] }) => { getClient(): Promise<GoogleAuthClient> };

export class CloudflareSecretManagerConfigurationError extends Error {
  constructor(message = "Cloudflare Google Secret Manager credentials are not configured.") {
    super(message);
    this.name = "CloudflareSecretManagerConfigurationError";
  }
}

let runtimeSecretManagerAdapterFactory: WhatsAppSecretManagerAdapterFactory | undefined;
let defaultSecretManagerAdapter: Promise<WhatsAppSecretManagerAdapter> | undefined;

/** Install a platform-specific adapter during runtime bootstrap. This is not
 * called during build; local Node development continues to use ADC by default. */
export function installWhatsAppSecretManagerAdapter(factory: WhatsAppSecretManagerAdapterFactory) {
  runtimeSecretManagerAdapterFactory = factory;
  defaultSecretManagerAdapter = undefined;
}

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
export async function createGoogleAdcSecretManagerAdapter(authConstructor?: GoogleAuthConstructor): Promise<WhatsAppSecretManagerAdapter> {
  // Keep both loading the Google auth library and ADC discovery inside the
  // runtime operation. Merely importing this module during a Cloudflare build
  // must never probe local credentials.
  const GoogleAuth = authConstructor ?? (await import("google-auth-library")).GoogleAuth as unknown as GoogleAuthConstructor;
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const base = (project: string) => `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}`;
  return {
    async readSecret(project, secretName) {
      const url = `${base(project)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
      const response = await client.request<{ payload?: { data?: string } }>({ url, method: "GET" });
      const encoded = response.data?.payload?.data;
      return typeof encoded === "string" ? Buffer.from(encoded, "base64").toString("utf8") : null;
    },
    async writeSecret(project, secretName, value) {
      const root = base(project);
      try {
        await client.request({ url: `${root}/secrets?secretId=${encodeURIComponent(secretName)}`, method: "POST", data: { replication: { automatic: {} } } });
      } catch (error: unknown) {
        const details = googleError(error);
        if (details.status !== 409) throw error;
      }
      await client.request({
        url: `${root}/secrets/${encodeURIComponent(secretName)}:addVersion`, method: "POST",
        data: { payload: { data: Buffer.from(value, "utf8").toString("base64") } },
      });
    },
  };
}

type CloudflareCredentials = {
  GCP_SERVICE_ACCOUNT_EMAIL?: string;
  GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID?: string;
  GCP_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
};

const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleSecretManagerScope = "https://www.googleapis.com/auth/cloud-platform";
const googleSecretManagerProject = "tany-whatsapp";
const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlText(value: string) {
  return base64Url(encoder.encode(value));
}

function privateKeyBytes(pem: string) {
  const body = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) throw new CloudflareSecretManagerConfigurationError("Cloudflare Google service-account private key is invalid.");
  const decoded = atob(body);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function createServiceAccountAssertion(credentials: Required<CloudflareCredentials>, nowMs = Date.now()) {
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT", kid: credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID }));
  const issuedAt = Math.floor(nowMs / 1000);
  const claims = base64UrlText(JSON.stringify({
    iss: credentials.GCP_SERVICE_ACCOUNT_EMAIL,
    scope: googleSecretManagerScope,
    aud: googleTokenEndpoint,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

function googleApiError(status: number, payload: unknown) {
  const errorValue = typeof payload === "object" && payload !== null && "error" in payload
    ? (payload as { error?: { status?: string; message?: string } }).error
    : undefined;
  const error = new Error(`Google Secret Manager request failed (${status}).`);
  Object.assign(error, { response: { status, data: { error: errorValue } } });
  return error;
}

async function fetchJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok) throw googleApiError(response.status, payload);
  return payload as T;
}

/** Google Secret Manager adapter for Cloudflare Workers. The service account
 * must have access only to the tany-whatsapp project and required secrets. */
export function createCloudflareSecretManagerAdapter(
  options: { credentials?: CloudflareCredentials; fetcher?: typeof fetch; now?: () => number } = {},
): WhatsAppSecretManagerAdapter {
  const env = options.credentials ?? process.env;
  const email = env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
  const privateKeyId = env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID?.trim() ?? "";
  const privateKey = env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() ?? "";
  if (!email || !privateKeyId || !privateKey || !email.endsWith(".iam.gserviceaccount.com"))
    throw new CloudflareSecretManagerConfigurationError();
  const credentials = { GCP_SERVICE_ACCOUNT_EMAIL: email, GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID: privateKeyId, GCP_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey };
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | undefined;
  let pendingToken: Promise<string> | undefined;

  async function accessToken() {
    if (cachedToken && cachedToken.expiresAt - now() > 60_000) return cachedToken.value;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const assertion = await createServiceAccountAssertion(credentials, now());
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      });
      const response = await fetchJson<{ access_token?: unknown; expires_in?: unknown }>(fetcher, googleTokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (typeof response.access_token !== "string" || !response.access_token || typeof response.expires_in !== "number")
        throw new Error("Google OAuth returned an invalid access token response.");
      cachedToken = { value: response.access_token, expiresAt: now() + response.expires_in * 1000 };
      return response.access_token;
    })().finally(() => { pendingToken = undefined; });
    return pendingToken;
  }

  function projectRoot(project: string) {
    if (project !== googleSecretManagerProject)
      throw new Error(`Google Secret Manager is restricted to project ${googleSecretManagerProject}.`);
    return `https://secretmanager.googleapis.com/v1/projects/${googleSecretManagerProject}`;
  }

  return {
    async readSecret(project, secretName) {
      const url = `${projectRoot(project)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
      const result = await fetchJson<{ payload?: { data?: unknown } }>(fetcher, url, {
        method: "GET",
        headers: { Authorization: `Bearer ${await accessToken()}` },
      });
      if (typeof result.payload?.data !== "string") return null;
      return new TextDecoder().decode(Uint8Array.from(atob(result.payload.data), character => character.charCodeAt(0)));
    },
    async writeSecret(project, secretName, value) {
      const root = projectRoot(project);
      const authorization = `Bearer ${await accessToken()}`;
      try {
        await fetchJson(fetcher, `${root}/secrets?secretId=${encodeURIComponent(secretName)}`, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ replication: { automatic: {} } }),
        });
      } catch (error) {
        if (googleError(error).status !== 409) throw error;
      }
      await fetchJson(fetcher, `${root}/secrets/${encodeURIComponent(secretName)}:addVersion`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { data: btoa(Array.from(encoder.encode(value), byte => String.fromCharCode(byte)).join("")) } }),
      });
    },
  };
}

function isCloudflareWorkerRuntime() {
  const globals = globalThis as typeof globalThis & { WebSocketPair?: unknown; navigator?: { userAgent?: string }; caches?: { default?: unknown } };
  return typeof globals.WebSocketPair === "function"
    || Boolean(globals.caches && "default" in globals.caches)
    || /Cloudflare-Workers/i.test(globals.navigator?.userAgent ?? "");
}

async function secretManagerAdapter() {
  if (runtimeSecretManagerAdapterFactory) return runtimeSecretManagerAdapterFactory();
  defaultSecretManagerAdapter ??= isCloudflareWorkerRuntime()
    ? Promise.resolve().then(() => createCloudflareSecretManagerAdapter())
    : createGoogleAdcSecretManagerAdapter();
  try { return await defaultSecretManagerAdapter; }
  catch (error) { defaultSecretManagerAdapter = undefined; throw error; }
}

async function secretManagerAccessToken(secretName: string): Promise<string | null> {
  try {
    return await (await secretManagerAdapter()).readSecret(projectId(), secretName);
  } catch { return null; }
}
export async function accountAccessToken(secretName: string, businessId: string): Promise<string | null> {
  if (!isAllowedTokenSecretName(secretName, businessId)) return null;
  if (isManagedSecretName(secretName, businessId)) return secretManagerAccessToken(secretName);
  if (process.env.MESSAGING_DATABASE === "postgres" || process.env.MESSAGING_DATABASE === "dual-write") return null;
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
  try {
    await (await secretManagerAdapter()).writeSecret(project, secretName, token);
  } catch (error) {
    const details = googleError(error);
    const operation = error instanceof Error && error.message.toLowerCase().includes("credential") ? "credentials" : "store-secret";
    log("SECRET_STORE_FAILED", { operation, ...details });
    throw new CredentialStorageError(operation, project, details.status, details.reason);
  }
  log("SECRET_STORED", {});
  return secretName;
}
