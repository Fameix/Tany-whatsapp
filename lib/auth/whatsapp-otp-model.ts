/** Pure parts of WhatsApp OTP sign-in, safe to test without a database or Meta. */
export type WhatsAppOtpSender = { businessId: string; phoneNumberId: string; template: { name: string; language: string } };

export const whatsappOtpTtlMs = 5 * 60_000;
export const whatsappOtpResendCooldownMs = 60_000;

/** Meta's send format for an Authentication template: the code fills the body variable and the
 * copy-code button (Meta requires both). */
export function authenticationTemplatePayload(phone: string, code: string, template: WhatsAppOtpSender["template"]) {
  if (!/^\d{6}$/.test(code)) throw new Error("A sign-in code has six digits.");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone.replace(/^\+/, ""),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

export type WhatsAppOtpUnavailable = "BUSINESS_INACTIVE" | "NOT_CONNECTED" | "NO_AUTH_TEMPLATE";

/** Who may send a business's sign-in codes: only that business's own connected number, with one of
 * its approved Authentication templates. Never a central number or another business's account. */
export function chooseWhatsAppOtpSender(
  businessId: string,
  business: { active: boolean; whatsappPhoneNumberId: string } | null,
  account: { businessId: string; status: string; phoneNumberId: string } | null,
  templates: { name: string; language: string; status: string; storedCategory: string }[],
): WhatsAppOtpSender | WhatsAppOtpUnavailable {
  if (!business?.active) return "BUSINESS_INACTIVE";
  const phoneNumberId = business.whatsappPhoneNumberId;
  if (!phoneNumberId || account?.businessId !== businessId || account.status !== "connected" || account.phoneNumberId !== phoneNumberId) return "NOT_CONNECTED";
  const template = templates.find(candidate => candidate.status === "approved" && candidate.storedCategory === "authentication");
  return template ? { businessId, phoneNumberId, template: { name: template.name, language: template.language } } : "NO_AUTH_TEMPLATE";
}

/** Seconds a caller must wait before another code for the same business and phone, or 0. */
export function resendWaitSeconds(lastSentAt: Date | string | null | undefined, now = Date.now()) {
  if (!lastSentAt) return 0;
  const wait = new Date(lastSentAt).getTime() + whatsappOtpResendCooldownMs - now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}
