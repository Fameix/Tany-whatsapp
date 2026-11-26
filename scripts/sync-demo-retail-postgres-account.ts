import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

import { adminDb } from "@/lib/firebase-admin";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { isAllowedTokenSecretName } from "@/lib/whatsapp/credentials";

const businessId = "demo-retail";
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

async function main() {
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging")
    throw new Error("Refusing account sync: MESSAGING_POSTGRES_TARGET must be staging.");
  const snapshot = await adminDb.collection("whatsapp_accounts").doc(businessId).get();
  const source = snapshot.data();
  if (!source || source.businessId !== businessId)
    throw new Error("Demo Retail Firestore WhatsApp account was not found.");

  // Allowlist only: no raw credential field is read or passed to Postgres.
  const tokenSecretName = text(source.tokenSecretName);
  const phoneNumberId = text(source.phoneNumberId);
  const wabaId = text(source.wabaId);
  const vertical = text(source.vertical);
  if (!tokenSecretName || !phoneNumberId || !wabaId || !vertical)
    throw new Error("Demo Retail Firestore account is missing required non-secret metadata.");
  if (!isAllowedTokenSecretName(tokenSecretName, businessId))
    throw new Error("Demo Retail token secret reference is not approved for this business.");

  await new PostgresMessagingRepository().mirrorAccount({
    id: businessId,
    businessId,
    vertical,
    wabaId,
    phoneNumberId,
    displayPhone: text(source.displayPhone),
    displayName: text(source.displayName),
    tokenSecretName,
    status: text(source.status) || "pending",
    testPassed: source.testPassed === true,
    validationMode: text(source.validationMode) || null,
    testMessage: text(source.testMessage),
    testedAt: source.testedAt?.toDate?.() ?? null,
  });
  console.log("Synced Demo Retail WhatsApp account metadata and phone mapping to Postgres.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Demo Retail account sync failed.");
  process.exitCode = 1;
});
