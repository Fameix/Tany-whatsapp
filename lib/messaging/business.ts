import { databaseMode, repositoryFor } from "@/lib/data/repository";
import { PostgresMessagingRepository } from "@/lib/data/postgres-messaging-repository";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import type { Business } from "@/lib/messaging/types";

export type { Business } from "@/lib/messaging/types";

const postgresPhoneLookup = (mode = databaseMode()) =>
  mode === "dual-write" || mode === "postgres";
const safePhoneMappingDiagnostic = (phoneNumberId: string) => ({
  phoneNumberIdSuffix: phoneNumberId.slice(-4),
  length: phoneNumberId.length,
});

export async function findBusinessByPhoneNumberId(
  phoneNumberId: string
): Promise<Business | null> {
  let data;
  if (postgresPhoneLookup()) {
    try {
      data = await new PostgresMessagingRepository().findActiveBusinessByPhoneNumberId(phoneNumberId);
    } catch (error) {
      console.error("[POSTGRES_PHONE_MAPPING_LOOKUP_FAILED]", {
        ...safePhoneMappingDiagnostic(phoneNumberId),
        code: error instanceof Error ? error.name : "UNKNOWN",
      });
      throw new Error("POSTGRES_PHONE_MAPPING_LOOKUP_FAILED");
    }
    if (!data) {
      console.warn("[POSTGRES_PHONE_MAPPING_NOT_FOUND]", safePhoneMappingDiagnostic(phoneNumberId));
      return null;
    }
  } else data = await (await repositoryFor()).findActiveBusinessByPhoneNumberId(phoneNumberId);
  if (!data) return null;

  if (!isActiveTanyVertical(data.vertical)) {
    throw new Error(`Tany vertical is not active for business ${data.id}`);
  }
  if (
    typeof data.name !== "string" ||
    typeof data.whatsappPhoneNumberId !== "string" ||
    typeof data.active !== "boolean"
  ) {
    throw new Error(`Invalid business data for ${data.id}`);
  }

  return {
    id: data.id,
    name: data.name,
    vertical: data.vertical,
    whatsappPhoneNumberId: data.whatsappPhoneNumberId,
    active: data.active,
  };
}
