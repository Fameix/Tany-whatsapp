import "server-only";
import { documentId } from "@/lib/messaging/services/shared";
import { accountAccessToken, CredentialStorageError, managedTokenSecretName, storeEmbeddedSignupAccessToken } from "@/lib/whatsapp/credentials";
import { activateWhatsAppSetup, getWhatsAppSetup, saveWhatsAppSetup, SetupError, testWhatsAppSetup } from "@/lib/whatsapp/setup-service";
import { databaseMode } from "@/lib/data/repository";
import { embeddedSignupConfigIdPattern } from "@/lib/whatsapp/embedded-signup-login";

const graphVersion = process.env.META_GRAPH_VERSION || "v27.0";
type ProviderPhone = { id?: string; display_phone_number?: string; verified_name?: string };
const numericId = (value: unknown) => typeof value === "string" && /^\d{1,40}$/.test(value) ? value : "";
export type EmbeddedSignupDependencies = {
  exchangeCode?: (code: string) => Promise<string>;
  graph?: <T>(path: string, token: string, init?: RequestInit) => Promise<T>;
  storeToken?: (businessId: string, token: string) => Promise<string>;
  validateSetup?: (businessId: string) => Promise<void>;
  credentialAvailable?: (businessId: string, secretReference: string) => Promise<boolean>;
  debugToken?: (token: string) => Promise<EmbeddedSignupTokenInfo>;
  /** Expected Meta app (defaults to NEXT_PUBLIC_META_APP_ID); the signup token must belong to it. */
  appId?: string;
};
/** Safe projection of Meta's debug_token response for an Embedded Signup business token. */
export type EmbeddedSignupTokenInfo = { appId: string; isValid: boolean; type: string; scopes: string[]; wabaIds: string[] };

/** Masks long numeric IDs to their last four digits so diagnostics never carry full Meta IDs. */
const maskIds = (value: string) => value.replace(/\d{6,}/g, (id) => `…${id.slice(-4)}`);
function signupLog(step: string, details: Record<string, unknown>) {
  console.info(`[EMBEDDED_SIGNUP] ${step}`, details);
}

function metaConfiguration() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const configId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !configId || !appSecret) throw new SetupError("EMBEDDED_SIGNUP_UNAVAILABLE", "WhatsApp Embedded Signup is not configured for this environment.", 503);
  return { appId, configId, appSecret };
}
async function graph<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const endpoint = `${init?.method ?? "GET"} ${maskIds(path.split("?")[0])}`;
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null) as (T & { error?: { code?: unknown; error_subcode?: unknown; type?: unknown; message?: unknown } }) | null;
  if (!response.ok || !body) {
    const error = body?.error;
    signupLog("GRAPH_FAILED", { endpoint, status: response.status, code: error?.code, subcode: error?.error_subcode, type: error?.type, message: typeof error?.message === "string" ? maskIds(error.message) : undefined });
    throw new SetupError("META_VALIDATION_FAILED", "Meta could not validate this WhatsApp account. Please try again.", 422);
  }
  signupLog("GRAPH_OK", { endpoint, status: response.status });
  return body;
}
/** Embedded Signup returns a business integration system-user token: `me` is a system user,
 * which has no owned_whatsapp_business_accounts edge. The WABAs granted in the signup are
 * listed in the token's granular scopes, read with the app access token. */
async function debugToken(token: string): Promise<EmbeddedSignupTokenInfo> {
  const { appId, appSecret } = metaConfiguration();
  const url = new URL(`https://graph.facebook.com/${graphVersion}/debug_token`);
  url.searchParams.set("input_token", token);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${appId}|${appSecret}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => null) as { data?: Record<string, unknown>; error?: { code?: unknown; error_subcode?: unknown; message?: unknown } } | null;
  const data = body?.data;
  if (!response.ok || !data) {
    signupLog("GRAPH_FAILED", { endpoint: "GET debug_token", status: response.status, code: body?.error?.code, subcode: body?.error?.error_subcode, message: typeof body?.error?.message === "string" ? maskIds(body.error.message) : undefined });
    throw new SetupError("META_VALIDATION_FAILED", "Meta could not validate this WhatsApp account. Please try again.", 422);
  }
  const granular = Array.isArray(data.granular_scopes) ? data.granular_scopes as Array<{ scope?: unknown; target_ids?: unknown }> : [];
  const management = granular.find(item => item.scope === "whatsapp_business_management");
  return {
    appId: typeof data.app_id === "string" ? data.app_id : "",
    isValid: data.is_valid === true,
    type: typeof data.type === "string" ? data.type : "",
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    wabaIds: Array.isArray(management?.target_ids) ? management.target_ids.map(numericId).filter(Boolean) : [],
  };
}
async function exchangeCode(code: string) {
  const { appId, appSecret } = metaConfiguration();
  if (!/^[A-Za-z0-9._~\-]{8,4096}$/.test(code)) throw new SetupError("INVALID_SIGNUP_RESPONSE", "The Meta authorization response was invalid.");
  const url = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  url.searchParams.set("client_id", appId); url.searchParams.set("client_secret", appSecret); url.searchParams.set("code", code);
  const response = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => null) as { access_token?: unknown } | null;
  if (!response.ok || !body || typeof body.access_token !== "string" || !body.access_token) throw new SetupError("META_EXCHANGE_FAILED", "Meta could not complete authorization. Please restart signup.", 422);
  return body.access_token;
}

/** Completes an Embedded Signup code entirely server-side. Provider IDs supplied
 * by the browser are treated only as hints and verified against Meta. */
export async function completeEmbeddedSignup(businessId: string, input: unknown, dependencies: EmbeddedSignupDependencies = {}) {
  documentId(businessId);
  if (!(["postgres", "dual-write"] as string[]).includes(databaseMode())) throw new SetupError("POSTGRES_REQUIRED", "WhatsApp onboarding requires the staging Postgres directory.", 503);
  const existing = await getWhatsAppSetup(businessId);
  if (existing?.status === "connected" && existing.testPassed && existing.validationMode === "live") throw new SetupError("ALREADY_CONNECTED", "This business already has a verified WhatsApp connection.", 409);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SetupError("INVALID_INPUT", "The signup response is invalid.");
  const value = input as Record<string, unknown>;
  const authorizationCode = typeof value.code === "string" ? value.code : "";
  if (!/^[A-Za-z0-9._~\-]{8,4096}$/.test(authorizationCode)) throw new SetupError("INVALID_SIGNUP_RESPONSE", "The Meta authorization response was invalid.");
  const exchange = dependencies.exchangeCode ?? exchangeCode;
  const requestGraph = dependencies.graph ?? graph;
  const storeToken = dependencies.storeToken ?? storeEmbeddedSignupAccessToken;
  const token = await exchange(authorizationCode);
  signupLog("CODE_EXCHANGED", { businessId, exchanged: true });
  const tokenInfo = await (dependencies.debugToken ?? debugToken)(token);
  const appId = dependencies.appId ?? metaConfiguration().appId;
  signupLog("TOKEN_SCOPES", { businessId, appMatches: tokenInfo.appId === appId, valid: tokenInfo.isValid, type: tokenInfo.type, scopes: tokenInfo.scopes, grantedWabas: tokenInfo.wabaIds.map(id => `…${id.slice(-4)}`) });
  if (!tokenInfo.isValid || !tokenInfo.appId || tokenInfo.appId !== appId)
    throw new SetupError("META_VALIDATION_FAILED", "Meta returned an authorization for a different app. Please restart signup.", 422);
  if (!tokenInfo.scopes.includes("whatsapp_business_management"))
    throw new SetupError("META_PERMISSION_REQUIRED", "Meta signup did not grant WhatsApp Business management permission. Restart signup and approve all requested permissions.", 403);
  const hintedWabaId = numericId(value.wabaId);
  const hintedPhoneNumberId = numericId(value.phoneNumberId);
  const hintedWabaIds = Array.isArray(value.wabaIds) ? value.wabaIds.map(numericId).filter(Boolean) : [];
  const availableWabas = tokenInfo.wabaIds;
  const requestedWabas = [...new Set([...(hintedWabaId ? [hintedWabaId] : []), ...hintedWabaIds])];
  const hintedCandidates = requestedWabas.filter(id => availableWabas.includes(id));
  if (requestedWabas.length && !hintedCandidates.length) throw new SetupError("META_ACCOUNT_SELECTION_REQUIRED", "The selected WhatsApp business account is not available to this Meta user.", 403);
  const candidates = requestedWabas.length ? hintedCandidates : availableWabas;
  if (!candidates.length) throw new SetupError("META_ACCOUNT_SELECTION_REQUIRED", "Meta did not return a WhatsApp business account. Restart signup and select your account.", 422);
  const phoneCandidates: Array<{ wabaId: string; phone: ProviderPhone }> = [];
  for (const wabaId of candidates) {
    const phones = await requestGraph<{ data?: ProviderPhone[] }>(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`, token);
    const availablePhones = (phones.data ?? []).filter(phone => numericId(phone.id) && typeof phone.display_phone_number === "string");
    for (const phone of availablePhones) if (!hintedPhoneNumberId || numericId(phone.id) === hintedPhoneNumberId) phoneCandidates.push({ wabaId, phone });
  }
  signupLog("PHONE_LOOKUP", { businessId, wabas: candidates.map(id => `…${id.slice(-4)}`), hintedPhone: hintedPhoneNumberId ? `…${hintedPhoneNumberId.slice(-4)}` : null, matches: phoneCandidates.map(item => `…${String(item.phone.id).slice(-4)}`) });
  if (phoneCandidates.length !== 1) throw new SetupError("META_PHONE_SELECTION_REQUIRED", "Meta did not return one verified phone number for this business. Finish number verification and select a single number in Meta.", 422);
  const { wabaId, phone } = phoneCandidates[0];
  const phoneNumberId = numericId(phone.id);
  if (!phoneNumberId || typeof phone.display_phone_number !== "string") throw new SetupError("META_PHONE_SELECTION_REQUIRED", "Meta did not return a verified WhatsApp phone number. Finish number verification in Meta and try again.", 422);
  const repository = await import("@/lib/data/postgres-messaging-repository");
  try { await new repository.PostgresMessagingRepository().assertWhatsAppPhoneAvailable(businessId, phoneNumberId); }
  catch (error) {
    if (error instanceof Error && error.message === "POSTGRES_PHONE_ALREADY_CONNECTED") throw new SetupError("PHONE_ALREADY_CONNECTED", "This WhatsApp phone number is already connected to another business.", 409);
    throw error;
  }
  const secretName = managedTokenSecretName(businessId);
  // Subscribe before activation. A failed subscription leaves the account pending.
  await requestGraph(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: "POST" });
  const step = async <T>(name: string, run: () => Promise<T>) => {
    try { const result = await run(); signupLog(`${name}_OK`, { businessId }); return result; }
    catch (error) {
      signupLog(`${name}_FAILED`, { businessId, code: error instanceof SetupError ? error.code : undefined, error: error instanceof Error ? error.name : typeof error, ...(error instanceof CredentialStorageError ? { operation: error.operation, project: error.project, status: error.status, reason: error.reason } : {}) });
      if (error instanceof CredentialStorageError)
        throw new SetupError("SECRET_STORAGE_UNAVAILABLE", "Tany could not store the WhatsApp credential securely. Please try again or contact Tany support.", 503);
      throw error;
    }
  };
  await step("ACCOUNT_SAVE", () => saveWhatsAppSetup(businessId, {
    setupType: "existing", displayName: phone.verified_name || "WhatsApp Business", displayPhone: phone.display_phone_number,
    phoneNumberId, wabaId, tokenSecretName: secretName,
  }));
  const storedSecretName = await step("SECRET_STORE", () => storeToken(businessId, token));
  if (storedSecretName !== secretName) throw new SetupError("SECRET_REFERENCE_MISMATCH", "Secure credential storage returned an invalid reference.", 503);
  await step("LIVE_TEST", async () => {
    if (dependencies.validateSetup) await dependencies.validateSetup(businessId);
    else await testWhatsAppSetup(businessId, { mode: "live", sendTest: false });
  });
  return step("ACTIVATE", () => activateWhatsAppSetup(businessId, dependencies.credentialAvailable
    ? (secretReference) => dependencies.credentialAvailable!(businessId, secretReference)
    : undefined));
}

export function embeddedSignupClientConfiguration() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const configId = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  return appId && configId && embeddedSignupConfigIdPattern.test(configId) ? { appId, configId, graphVersion } : null;
}

/** Keeps credential lookup async and server-only; exported only for focused tests. */
export async function embeddedSignupCredentialAvailable(businessId: string) {
  const account = await getWhatsAppSetup(businessId);
  return !!(account?.tokenSecretName && await accountAccessToken(account.tokenSecretName, businessId));
}
