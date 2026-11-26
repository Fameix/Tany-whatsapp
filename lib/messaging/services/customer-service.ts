import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { Customer } from "@/lib/messaging/domain-types";
import { customerDocumentId, serverTimestamp } from "@/lib/messaging/services/shared";
import { postgresContactProjection } from "@/lib/data/postgres-contact-privacy";
import { databaseMode, postgresShadowWrite } from "@/lib/data/repository";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { mutateRuntimeRecord } from "@/lib/messaging/services/postgres-runtime-records";

const postgresRuntimeReads = () => {
  const mode = databaseMode();
  return mode === "dual-write" || mode === "postgres";
};

export async function getOrCreateCustomer({ businessId, phone }: { businessId: string; phone: string }): Promise<Customer> {
  if (postgresRuntimeReads()) {
    const repo = new PostgresMessagingRepository();
    let existing: Record<string, unknown> | null;
    try {
      existing = await repo.getRuntimeContact(businessId, phone);
    } catch (error) {
      console.warn("[POSTGRES_CONTACT_LOOKUP_FAILED]", { businessId, code: error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "UNKNOWN" });
      throw error;
    }
    const privacy = postgresContactProjection(phone);
    const customerId = existing ? String(existing.legacy_customer_id) : customerDocumentId(businessId, phone);
    await repo.mirrorContact({ id: customerId, businessId, customerId, phoneEnc: privacy.phoneEnc, phoneHash: privacy.phoneHash, profileName: typeof existing?.profile_name === "string" ? existing.profile_name : "" });
    const now = Timestamp.now();
    const profile = await mutateRuntimeRecord<Customer & Record<string, unknown>>("customers", businessId, customerId, current => ({
      ...(current ?? { id: customerId, businessId, phone, name: typeof existing?.profile_name === "string" ? existing.profile_name : null, metadata: {}, createdAt: now, lastInteractionAt: now }),
      updatedAt: now, lastInteractionAt: now,
    }));
    const contact = existing ?? await repo.getRuntimeContact(businessId, phone);
    if (!contact) throw new Error("POSTGRES_CONTACT_WRITE_FAILED");
    return { ...profile, phone, name: profile.name ?? (typeof contact.profile_name === "string" ? contact.profile_name : null) } as Customer;
  }
  const ref = adminDb.collection("customers").doc(customerDocumentId(businessId, phone));
  const customer = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const now = serverTimestamp();
    if (snapshot.exists) {
      const changes = { lastInteractionAt: now, updatedAt: now };
      transaction.update(ref, changes);
      return { ...snapshot.data(), ...changes, id: ref.id } as Customer;
    }
    const data: Omit<Customer, "id"> = {
      businessId, phone, name: null, metadata: {},
      createdAt: now, updatedAt: now, lastInteractionAt: now,
    };
    transaction.create(ref, data);
    return { ...data, id: ref.id };
  });
  if (postgresRuntimeReads()) {
    const privacy = postgresContactProjection(phone);
    await postgresShadowWrite("contact", {
      id: customer.id,
      businessId,
      customerId: customer.id,
      phoneEnc: privacy.phoneEnc,
      phoneHash: privacy.phoneHash,
      profileName: typeof customer.name === "string" ? customer.name : "",
    });
  }
  return customer;
}
