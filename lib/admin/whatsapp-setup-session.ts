import "server-only";
import { signIntegrationAccess, verifyIntegrationAccess } from "@/lib/integration/access";

const audience = "tany-whatsapp-setup-v1";
const lifetimeSeconds = 15 * 60;
const production = process.env.NODE_ENV === "production";

export const whatsappSetupSessionCookieName = production
  ? "__Host-tany-wa-setup"
  : "tany-wa-setup-dev";

export const whatsappSetupSessionCookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
  maxAge: lifetimeSeconds,
};

export async function signWhatsAppSetupSession(secret: string, businessId: string) {
  return signIntegrationAccess(secret, { kind: "business", businessId }, Date.now(), audience, lifetimeSeconds);
}

export async function verifyWhatsAppSetupSession(secret: string, token: string, businessId: string) {
  if (!businessId || businessId.length > 1500 || businessId.includes("/")) return false;
  return verifyIntegrationAccess(secret, token, { kind: "business", businessId }, Date.now(), audience);
}
