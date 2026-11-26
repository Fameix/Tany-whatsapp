import "server-only";
import { requireWhatsAppEntitlement } from "@/lib/subscriptions/entitlements";
import { getWhatsAppSetup } from "@/lib/whatsapp/setup-service";
import { documentId } from "@/lib/messaging/services/shared";
import { getBusinessConfig } from "@/lib/messaging/services/business-config-service";

export class OperationsAccessError extends Error {
  constructor(public code: string, message: string, public status = 403) { super(message); }
}
export async function clientConnectionReady(businessId: string) {
  await requireWhatsAppEntitlement(businessId);
  const account = await getWhatsAppSetup(businessId);
  if (account) return account.status === "connected";
  const business = await getBusinessConfig(documentId(businessId));
  const whatsapp = business?.settings?.whatsapp;
  return business?.active === true && !!whatsapp && typeof whatsapp === "object" && !Array.isArray(whatsapp) && whatsapp.connectionStatus === "connected";
}
export async function requireClientConnection(businessId: string) {
  if (!await clientConnectionReady(businessId)) throw new OperationsAccessError("SETUP_REQUIRED", "Connect WhatsApp to open your dashboard.");
}
