import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

import { adminDb } from "@/lib/firebase-admin";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";

const businessId = "demo-retail";
const timestampMillis = (value: unknown, fallback: number) => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") return (value as { toMillis(): number }).toMillis();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
};

async function main() {
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging") throw new Error("Refusing entitlement backfill: MESSAGING_POSTGRES_TARGET must be staging.");
  const [subscriptionSnapshot, entitlementSnapshot] = await Promise.all([
    adminDb.collection("subscriptions").doc(businessId).get(),
    adminDb.collection("entitlements").doc(businessId).get(),
  ]);
  const subscription = subscriptionSnapshot.data();
  if (!subscription) {
    console.log(JSON.stringify({ migratedSubscriptions: 0, migratedEntitlements: 0, reason: "subscription_missing" }));
    return;
  }
  const entitlement = entitlementSnapshot.data() ?? {};
  const now = Date.now();
  const plan = typeof subscription.plan === "string" ? subscription.plan : "basic";
  const status = typeof subscription.status === "string" ? subscription.status : "expired";
  await new PostgresMessagingRepository().writeSubscriptionEntitlement({
    businessId,
    plan,
    status,
    startedAt: timestampMillis(subscription.startedAt, now),
    expiresAt: timestampMillis(subscription.expiresAt, 0),
    whatsappAutomation: entitlement.whatsappAutomation === true,
    campaigns: entitlement.campaigns === true,
    advancedAnalytics: entitlement.advancedAnalytics === true,
    aiAssistant: entitlement.aiAssistant === true,
  });
  console.log(JSON.stringify({ migratedSubscriptions: 1, migratedEntitlements: entitlementSnapshot.exists ? 1 : 0 }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Demo Retail entitlement backfill failed."); process.exitCode = 1; });
