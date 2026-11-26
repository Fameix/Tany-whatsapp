import "server-only";
import { documentId } from "@/lib/messaging/services/shared";
import { databaseMode, repositoryFor, runtimeRepositoryFor } from "@/lib/data/repository";
import { activeTanyVerticals } from "@/lib/messaging/vertical-config";

export type Plan = "basic" | "standard" | "pro";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "cancelled" | "expired";
export type Feature = "whatsappAutomation" | "campaigns" | "advancedAnalytics" | "aiAssistant";
// Stored plan IDs remain stable (`pro` is the existing Premium commercial tier).
export const whatsappProducts = activeTanyVerticals;
export type WhatsAppProduct = (typeof whatsappProducts)[number];
const disabled = { whatsappAutomation: false, campaigns: false, advancedAnalytics: false, aiAssistant: false };
// The sole plan-to-feature policy. Unspecified features remain disabled.
export const planEntitlements: Record<Plan, Record<Feature, boolean>> = {
  basic: { ...disabled }, standard: { ...disabled }, pro: { ...disabled, whatsappAutomation: true },
};
export const upgradeRequired = {
  success: false, code: "UPGRADE_REQUIRED", feature: "whatsappAutomation",
  requiredPlan: "pro", message: "WhatsApp Automation requires an active Pro subscription.",
} as const;
export class EntitlementError extends Error {
  readonly details = upgradeRequired;
  constructor() { super(upgradeRequired.message); }
}
async function subscriptionRepository() {
  const mode = databaseMode();
  if (mode === "postgres" || mode === "dual-write") {
    const { PostgresMessagingRepository } = await import("@/lib/data/postgres-messaging-repository");
    return new PostgresMessagingRepository();
  }
  return repositoryFor(mode);
}
export async function resolveEntitlements(businessId: string, now = Date.now()) {
  documentId(businessId);
  const { subscription, entitlement: stored } = await (await subscriptionRepository()).getSubscriptionAndEntitlement(businessId);
  const plan = subscription?.plan;
  const policy = typeof plan === "string" && Object.hasOwn(planEntitlements, plan)
    ? planEntitlements[plan as Plan] : disabled;
  const active = subscription !== null && stored !== null && subscription.businessId === businessId && stored.businessId === businessId &&
    subscription.status === "active" &&
    typeof subscription.startedAt === "number" && subscription.startedAt <= now &&
    typeof subscription.expiresAt === "number" && subscription.expiresAt > now;
  return Object.fromEntries(Object.keys(disabled).map(feature => [feature,
    Boolean(active && policy[feature as Feature] && stored?.[feature as Feature] === true),
  ])) as Record<Feature, boolean>;
}
export async function hasEntitlement(businessId: string, feature: Feature) {
  return (await resolveEntitlements(businessId))[feature] === true;
}
function isWhatsAppProduct(value: unknown): value is WhatsAppProduct {
  return typeof value === "string" && (whatsappProducts as readonly string[]).includes(value);
}
/**
 * Uses the existing business vertical as the single-product default. A business
 * can opt into multi-product messaging with a `products` array; unknown values
 * never grant access or become visible in the template gallery.
 */
export async function getEnabledProducts(businessId: string): Promise<WhatsAppProduct[]> {
  documentId(businessId);
  const business = await (await runtimeRepositoryFor()).getBusiness(businessId);
  if (!business || business.active !== true || !isWhatsAppProduct(business.vertical)) return [];
  // Empty/missing arrays preserve the existing single-vertical business model.
  const purchased = business.products.length > 0 ? business.products : [business.vertical];
  return [...new Set(purchased.filter(isWhatsAppProduct))];
}
/** The single commercial gate for WhatsApp routes, setup, and automations. */
export async function canUseWhatsApp(businessId: string) {
  const [entitled, products] = await Promise.all([
    hasEntitlement(businessId, "whatsappAutomation"),
    getEnabledProducts(businessId),
  ]);
  return entitled && products.length > 0;
}
export async function requireWhatsAppEntitlement(businessId: string) {
  if (!await canUseWhatsApp(businessId)) throw new EntitlementError();
}

/** Internal Admin-SDK method only; never export through a customer-facing action/API. */
export async function assignDemoSubscription(businessId: string, plan: Plan,
  status: SubscriptionStatus = "active", days = 30) {
  documentId(businessId);
  if (!Object.hasOwn(planEntitlements, plan) || !["active", "trialing", "past_due", "cancelled", "expired"].includes(status) ||
    !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid demo subscription.");
  const now = Date.now();
  const input = {
    businessId, plan, status, startedAt: now, expiresAt: now + days * 86400000, ...planEntitlements[plan],
  };
  const mode = databaseMode();
  if (mode === "postgres" || mode === "dual-write") {
    const { PostgresMessagingRepository } = await import("@/lib/data/postgres-messaging-repository");
    await new PostgresMessagingRepository().writeSubscriptionEntitlement(input);
    if (mode === "dual-write") {
      try { await (await repositoryFor("firestore")).writeSubscriptionEntitlement(input); }
      catch (error) { console.warn("[POSTGRES_SUBSCRIPTION_SHADOW_FAILED]", { businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" }); }
    }
    return;
  }
  await (await repositoryFor(mode)).writeSubscriptionEntitlement(input);
}
