import "server-only";
import { adminDb } from "@/lib/firebase-admin";
import type { AdminBusiness } from "@/lib/admin/types";

export async function listFirestoreBusinessProfiles(): Promise<AdminBusiness[]> {
  const snapshot = await adminDb.collection("businesses").get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      name: String(data.name ?? ""),
      vertical: data.vertical,
      active: data.active === true,
      whatsappPhoneNumberId: String(data.whatsappPhoneNumberId ?? ""),
      settings: data.settings ?? {},
    };
  });
}
