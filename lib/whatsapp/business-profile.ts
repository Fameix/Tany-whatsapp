import "server-only";
import { runtimeRepositoryFor } from "@/lib/data/repository";
import { accountAccessToken } from "@/lib/whatsapp/credentials";
import {
  displayNameStatus, profileVerticals, qualityRating, validatePicture, validateProfile,
  type BusinessProfile, type DisplayName, type EditableProfile, type ProfileDiagnostics, type ProfileVertical,
} from "./business-profile-model";

export type ProfileErrorCode = "NOT_CONNECTED" | "CREDENTIAL" | "PERMISSION" | "INVALID" | "META_UNAVAILABLE";
export class BusinessProfileError extends Error {
  constructor(public code: ProfileErrorCode, message: string) { super(message); }
}

const graphVersion = () => process.env.META_GRAPH_VERSION || "v27.0";
const graphRoot = () => `https://graph.facebook.com/${graphVersion()}`;
const profileFields = "about,address,description,email,profile_picture_url,websites,vertical";

type Dependencies = { fetcher?: typeof fetch };

/** This business's own connected phone number and Secret Manager credential. The phone
 * must map back to the same business; another tenant's number is never used. */
async function profileAccount(businessId: string) {
  const repository = await runtimeRepositoryFor();
  const account = await repository.getWhatsAppAccount(businessId);
  const phoneNumberId = typeof account?.phoneNumberId === "string" && /^\d{1,40}$/.test(account.phoneNumberId) ? account.phoneNumberId : "";
  if (!account || account.status !== "connected" || !phoneNumberId || !account.tokenSecretName)
    throw new BusinessProfileError("NOT_CONNECTED", "Connect WhatsApp to manage your business profile.");
  const owner = await repository.findWhatsAppAccountByPhoneNumberId(phoneNumberId);
  if (owner?.businessId !== businessId) throw new BusinessProfileError("NOT_CONNECTED", "This WhatsApp number isn't connected to your business.");
  const token = await accountAccessToken(account.tokenSecretName, businessId);
  if (!token) throw new BusinessProfileError("CREDENTIAL", "Tany couldn't access your WhatsApp connection. Reconnect WhatsApp and try again.");
  return { phoneNumberId, token, wabaId: typeof account.wabaId === "string" ? account.wabaId : "" };
}

/** Meta's user-facing message only; never the token, request or raw response. */
async function graph<T>(fetcher: typeof fetch, url: string, token: string, init: RequestInit & { authorization?: string } = {}): Promise<T> {
  const { authorization, headers, ...rest } = init;
  const response = await fetcher(url, { ...rest, headers: { Authorization: authorization ?? `Bearer ${token}`, ...(headers as Record<string, string> | undefined) } });
  const payload = await response.json().catch(() => null) as { error?: { code?: number; message?: string; error_user_msg?: string } } | null;
  if (response.ok && !payload?.error) return payload as T;
  const error = payload?.error;
  const message = (error?.error_user_msg || error?.message || "Meta couldn't complete this request.").replace(/[A-Za-z0-9_-]{40,}/g, "…").slice(0, 300);
  console.error("[WHATSAPP_PROFILE_META_FAILED]", { status: response.status, code: error?.code });
  if (error?.code === 190 || response.status === 401) throw new BusinessProfileError("CREDENTIAL", "Your WhatsApp connection has expired. Reconnect WhatsApp to manage your profile.");
  if (error?.code === 10 || error?.code === 200 || error?.code === 3 || response.status === 403) throw new BusinessProfileError("PERMISSION", "Tany doesn't have permission to manage this WhatsApp profile. Reconnect WhatsApp and approve all permissions.");
  if (error?.code === 100 || response.status === 400) throw new BusinessProfileError("INVALID", message);
  throw new BusinessProfileError("META_UNAVAILABLE", "WhatsApp couldn't be reached. Try again in a moment.");
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const vertical = (value: unknown): ProfileVertical => (profileVerticals.some(([v]) => v === value) ? value as ProfileVertical : "UNDEFINED");

export type ProfileSnapshot = { profile: BusinessProfile; displayName: DisplayName; diagnostics: ProfileDiagnostics; wabaId: string };

/** One fresh read from Meta: profile fields, display name, review status and quality. */
export async function getBusinessProfile(businessId: string, { fetcher = fetch }: Dependencies = {}): Promise<ProfileSnapshot> {
  const { phoneNumberId, token, wabaId } = await profileAccount(businessId);
  const [profileResult, phone] = await Promise.all([
    graph<{ data?: Array<Record<string, unknown>> }>(fetcher, `${graphRoot()}/${phoneNumberId}/whatsapp_business_profile?fields=${profileFields}`, token),
    graph<{ verified_name?: string; display_phone_number?: string; name_status?: string; quality_rating?: string }>(fetcher, `${graphRoot()}/${phoneNumberId}?fields=verified_name,display_phone_number,name_status,quality_rating`, token),
  ]);
  const data = profileResult.data?.[0] ?? {};
  return {
    profile: {
      about: text(data.about), description: text(data.description), email: text(data.email), address: text(data.address),
      websites: Array.isArray(data.websites) ? data.websites.filter((site): site is string => typeof site === "string") : [],
      vertical: vertical(data.vertical), profilePictureUrl: text(data.profile_picture_url),
    },
    displayName: { name: text(phone.verified_name), phone: text(phone.display_phone_number), status: displayNameStatus(phone.name_status), quality: qualityRating(phone.quality_rating) },
    diagnostics: { phoneNumberId, wabaId, refreshedAt: new Date().toISOString() },
    wabaId,
  };
}

/** Saves profile fields, then re-reads them so the caller shows what Meta actually stored. */
export async function updateBusinessProfile(businessId: string, input: EditableProfile, dependencies: Dependencies = {}) {
  const issues = validateProfile(input);
  if (issues.length) throw new BusinessProfileError("INVALID", issues[0].message);
  const { phoneNumberId, token } = await profileAccount(businessId);
  const fetcher = dependencies.fetcher ?? fetch;
  await graph(fetcher, `${graphRoot()}/${phoneNumberId}/whatsapp_business_profile`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      about: input.about.trim(), description: input.description.trim(), email: input.email.trim(), address: input.address.trim(),
      websites: input.websites.map(site => site.trim()).filter(Boolean), vertical: input.vertical,
    }),
  });
  return getBusinessProfile(businessId, dependencies);
}

/** Uploads a profile picture with Meta's Resumable Upload API and sets it on the profile. */
export async function updateProfilePicture(businessId: string, bytes: Uint8Array, type: string, dependencies: Dependencies = {}) {
  const problem = validatePicture(bytes, type);
  if (problem) throw new BusinessProfileError("INVALID", problem);
  const appId = (process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || "").trim();
  if (!/^\d{5,30}$/.test(appId)) throw new BusinessProfileError("META_UNAVAILABLE", "Profile pictures can't be updated in this environment.");
  const { phoneNumberId, token } = await profileAccount(businessId);
  const fetcher = dependencies.fetcher ?? fetch;
  const session = await graph<{ id?: string }>(fetcher, `${graphRoot()}/${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(type)}`, token, { method: "POST" });
  if (!session.id || !/^upload:[\w=?&.-]+$/.test(session.id)) throw new BusinessProfileError("META_UNAVAILABLE", "Meta didn't start the upload. Try again.");
  const uploaded = await graph<{ h?: string }>(fetcher, `${graphRoot()}/${session.id}`, token, {
    method: "POST", authorization: `OAuth ${token}`, headers: { file_offset: "0", "Content-Type": type }, body: bytes as BodyInit,
  });
  if (!uploaded.h) throw new BusinessProfileError("META_UNAVAILABLE", "Meta didn't accept the image. Try again.");
  await graph(fetcher, `${graphRoot()}/${phoneNumberId}/whatsapp_business_profile`, token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: uploaded.h }),
  });
  return getBusinessProfile(businessId, dependencies);
}
