import { runtimeRepositoryFor } from "@/lib/data/repository";
import { cache } from "react";
import type { Business } from "@/lib/messaging/types";
import type { ConversationContext } from "@/lib/messaging/domain-types";
import { mergeConversationContext } from "@/lib/messaging/context";
import { isTanyVertical } from "@/lib/messaging/vertical-config";
import { documentId } from "@/lib/messaging/services/shared";

export type BusinessConfig = Business & { settings: ConversationContext };
export const getBusinessConfig = cache(async (businessId: string): Promise<BusinessConfig | null> => {
  try {
    documentId(businessId);
    const data = await (await runtimeRepositoryFor()).getBusiness(businessId);
    if (!data || typeof data.name !== "string" || !isTanyVertical(data.vertical) || typeof data.active !== "boolean" || typeof data.whatsappPhoneNumberId !== "string") return null;
    return {
      id: data.id, name: data.name, vertical: data.vertical, active: data.active,
      whatsappPhoneNumberId: data.whatsappPhoneNumberId,
      settings: mergeConversationContext({}, data.settings as ConversationContext),
    };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      // Local product pages can run without ADC/Firestore. Returning no profile
      // lets the route render its normal unavailable state without a Next error
      // overlay or any credential detail in the browser console.
      void error;
      return null;
    }
    throw error;
  }
});
