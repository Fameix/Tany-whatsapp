import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

import { adminDb } from "@/lib/firebase-admin";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { isAllowedTokenSecretName } from "@/lib/whatsapp/credentials";

const businessId = "demo-retail";
const text = (value: unknown) => typeof value === "string" ? value : "";
const safeObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const forbidden = new Set(["accessToken", "access_token", "token", "refresh_token", "id_token"]);
  const clean = (child: unknown): unknown => Array.isArray(child) ? child.map(clean) : child && typeof child === "object" ? Object.fromEntries(Object.entries(child as Record<string, unknown>).filter(([key]) => !forbidden.has(key)).map(([key, nested]) => [key, clean(nested)])) : child;
  return clean(value) as Record<string, unknown>;
};

async function main() {
  if (process.env.MESSAGING_POSTGRES_TARGET !== "staging") throw new Error("Refusing runtime-config backfill: MESSAGING_POSTGRES_TARGET must be staging.");
  const [businessSnapshot, accountSnapshot, itemsSnapshot, mappingsSnapshot] = await Promise.all([
    adminDb.collection("businesses").doc(businessId).get(),
    adminDb.collection("whatsapp_accounts").doc(businessId).get(),
    adminDb.collection("businesses").doc(businessId).collection("catalog").get(),
    adminDb.collection("businesses").doc(businessId).collection("whatsapp_product_mappings").get(),
  ]);
  const business = businessSnapshot.data();
  if (!business) throw new Error("Demo Retail Firestore business configuration is missing.");
  const repository = new PostgresMessagingRepository();
  await repository.updateBusinessProfile(businessId, {
    name: text(business.name), vertical: text(business.vertical), active: business.active === true,
    products: Array.isArray(business.products) ? business.products.filter((v): v is string => typeof v === "string") : [],
    whatsappPhoneNumberId: text(business.whatsappPhoneNumberId), settings: safeObject(business.settings),
  });
  const account = accountSnapshot.data();
  let backfilledAccount = 0;
  if (account && account.businessId === businessId) {
    const secretName = text(account.tokenSecretName);
    if (secretName && !isAllowedTokenSecretName(secretName, businessId)) throw new Error("Demo Retail secret reference is not approved for this tenant.");
    await repository.mirrorAccount({
      id: businessId, businessId, vertical: text(account.vertical) || text(business.vertical),
      setupType: text(account.setupType) || "existing", businessName: text(account.businessName),
      phoneNumberId: text(account.phoneNumberId), wabaId: text(account.wabaId), displayPhone: text(account.displayPhone),
      displayName: text(account.displayName), tokenSecretName: secretName, status: text(account.status) || "pending",
      setupStep: Number(account.setupStep) || 5, revision: Number(account.revision) || 1,
      testPassed: account.testPassed === true, validationMode: text(account.validationMode), testMessage: text(account.testMessage),
      testedAt: account.testedAt?.toDate?.() ?? null, catalogId: text(account.catalogId), catalogEnabled: account.catalogEnabled === true,
      activatedAt: account.activatedAt?.toDate?.() ?? null, internalTestingActive: account.internalTestingActive === true, testStatus: text(account.testStatus),
    });
    backfilledAccount = 1;
  }
  for (const doc of itemsSnapshot.docs) {
    const item = doc.data();
    if (typeof item.name !== "string" || typeof item.type !== "string" || typeof item.price !== "number" || typeof item.available !== "boolean") continue;
    await repository.saveCatalogItem(businessId, doc.id, {
      type: item.type, name: item.name, description: text(item.description), price: item.price,
      available: item.available, category: typeof item.category === "string" ? item.category : null, metadata: safeObject(item.metadata),
    });
  }
  let backfilledMappings = 0;
  for (const doc of mappingsSnapshot.docs) {
    const mapping = doc.data();
    if (mapping.businessId !== businessId || typeof mapping.retailerProductId !== "string" || typeof mapping.catalogId !== "string") continue;
    const itemId = text(mapping.tanyProductId) || doc.id;
    await repository.saveCatalogMapping(businessId, itemId, mapping.retailerProductId, mapping.catalogId);
    backfilledMappings++;
  }
  console.log(JSON.stringify({ businesses: 1, accounts: backfilledAccount, catalogItems: itemsSnapshot.size, catalogMappings: backfilledMappings }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Demo Retail runtime config backfill failed."); process.exitCode = 1; });
