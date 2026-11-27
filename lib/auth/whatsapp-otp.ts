import "server-only";
import { runtimeRepositoryFor } from "@/lib/data/repository";
import { sendingAccessToken } from "@/lib/whatsapp/runtime-account";
import { listBusinessTemplates } from "@/lib/templates/repository";
import { authenticationTemplatePayload, chooseWhatsAppOtpSender, type WhatsAppOtpSender, type WhatsAppOtpUnavailable } from "./whatsapp-otp-model";

export { authenticationTemplatePayload, type WhatsAppOtpSender } from "./whatsapp-otp-model";

export class WhatsAppOtpUnavailableError extends Error {
  constructor(public reason: WhatsAppOtpUnavailable) { super(reason); }
}

/** The business's own sender for sign-in codes: its connected WhatsApp number and an approved
 * Authentication template. There is no central Tany number and no fallback to another business. */
export async function whatsappOtpSender(businessId: string): Promise<WhatsAppOtpSender> {
  const repository = await runtimeRepositoryFor();
  const [business, account, templates] = await Promise.all([
    repository.getBusiness(businessId), repository.getWhatsAppAccount(businessId), listBusinessTemplates(businessId).catch(() => []),
  ]);
  const sender = chooseWhatsAppOtpSender(businessId, business, account, templates);
  if (typeof sender === "string") throw new WhatsAppOtpUnavailableError(sender);
  return sender;
}

/** Sends the code from the business's own number. The code is never logged; only Meta's status is. */
export async function deliverWhatsAppOtp(sender: WhatsAppOtpSender, phone: string, code: string): Promise<void> {
  // sendingAccessToken re-checks that this number is the business's own active account.
  const token = await sendingAccessToken(sender.phoneNumberId);
  const response = await fetch(`https://graph.facebook.com/v26.0/${encodeURIComponent(sender.phoneNumberId)}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(authenticationTemplatePayload(phone, code, sender.template)),
  });
  const result = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: unknown } } | null;
  if (!response.ok || !result?.messages?.[0]?.id) {
    console.error("[WHATSAPP_OTP_SEND_FAILED]", { status: response.status, metaError: typeof result?.error?.code === "number" ? result.error.code : null });
    throw new Error("WHATSAPP_OTP_SEND_FAILED");
  }
}
