import "server-only";
import { databaseMode, runtimeRepositoryFor } from "@/lib/data/repository";
import { accountAccessToken } from "@/lib/whatsapp/credentials";
import { adminDb } from "@/lib/firebase-admin";

function activeStatus(status: unknown) {
  return status === "connected" || status === "configured";
}

/** Existing businesses without wizard records keep their current integration. */
export async function automationAccountReady(businessId: string, phoneNumberId: string) {
  const repository = await runtimeRepositoryFor();
  const [canonical, match] = await Promise.all([
    repository.getWhatsAppAccount(businessId),
    repository.findWhatsAppAccountByPhoneNumberId(phoneNumberId),
  ]);
  if (databaseMode() !== "postgres" && databaseMode() !== "dual-write") {
    const allMatches = await adminDb.collection("whatsapp_accounts").where("phoneNumberId", "==", phoneNumberId).get();
    if (allMatches.docs.some(doc => doc.data().businessId !== businessId) || allMatches.docs.length > 1) return false;
  }
  // Preserve legacy businesses that have not created any setup/account record.
  if (!canonical && !match) return true;
  if (canonical && (!activeStatus(canonical.status) || canonical.phoneNumberId !== phoneNumberId)) return false;
  if (!match) return false;
  const data = match;
  // Connected manual records need no wizard proof. Incomplete and inactive
  // records never qualify; client activation still uses the wizard service.
  return data.businessId === businessId && activeStatus(data.status) &&
    data.phoneNumberId === phoneNumberId && !!phoneNumberId.trim() &&
    typeof data.wabaId === "string" && /^\d{1,40}$/.test(data.wabaId) &&
    typeof data.displayPhone === "string" && /^\+?[1-9]\d{7,14}$/.test(data.displayPhone.replace(/[\s()-]/g, ""));
}
export async function sendingAccessToken(phoneNumberId: string) {
  const repository = await runtimeRepositoryFor();
  const account = await repository.findWhatsAppAccountByPhoneNumberId(phoneNumberId);
  // A sender is usable only when its single, business-owned account is present.
  // The Firestore deployment retains its legacy server token for businesses
  // that have never created a canonical account record. Postgres mode requires
  // a tenant-owned secret reference and never falls back to Firestore or global credentials.
  if (!account) {
    if (databaseMode() === "firestore" && process.env.META_ACCESS_TOKEN) return process.env.META_ACCESS_TOKEN;
    throw new Error("WhatsApp account ownership is unavailable.");
  }
  const business = await repository.getBusiness(account.businessId);
  if (!activeStatus(account.status) || business?.active !== true || business.whatsappPhoneNumberId !== phoneNumberId || !(await automationAccountReady(account.businessId, phoneNumberId)))
    throw new Error("WhatsApp account is not active.");
  if (!account.tokenSecretName) throw new Error("WhatsApp account secret reference is unavailable.");
  return await accountAccessToken(account.tokenSecretName, account.businessId);
}
