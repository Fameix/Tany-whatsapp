"use server";
import { revalidatePath } from "next/cache";
import { DashboardAuthorizationError, requireDashboardAccess } from "@/lib/admin/dashboard-session";
import { loadBusiness } from "@/app/business/_components/load-business";
import { BusinessProfileError, getBusinessProfile, updateBusinessProfile, updateProfilePicture, type ProfileSnapshot } from "@/lib/whatsapp/business-profile";
import type { EditableProfile } from "@/lib/whatsapp/business-profile-model";
import { requireProductWhatsAppBusiness } from "@/lib/admin/product-whatsapp-access";

/** The snapshot never carries credentials: profile fields, display name, status and Meta IDs only. */
export type ProfileActionResult = { ok: true; snapshot: ProfileSnapshot; message: string } | { ok: false; message: string };

function failure(error: unknown): ProfileActionResult {
  if (error instanceof DashboardAuthorizationError) return { ok: false, message: "You don't have access to this business." };
  if (error instanceof BusinessProfileError) return { ok: false, message: error.message };
  console.error("[WHATSAPP_PROFILE_ACTION_FAILED]", { error: error instanceof Error ? error.name : typeof error });
  return { ok: false, message: "Something went wrong. Please try again." };
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export async function saveBusinessProfile(businessId: string, input: unknown, product?: string): Promise<ProfileActionResult> {
  try {
    if (product !== undefined) await requireProductWhatsAppBusiness(product, businessId, true);
    else await requireDashboardAccess(businessId);
    await loadBusiness(businessId);
    const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const profile: EditableProfile = {
      about: str(value.about, 200), description: str(value.description, 600), email: str(value.email, 200).trim(), address: str(value.address, 300),
      websites: Array.isArray(value.websites) ? value.websites.slice(0, 3).map(site => str(site, 300).trim()).filter(Boolean) : [],
      vertical: str(value.vertical, 40) as EditableProfile["vertical"],
    };
    const snapshot = await updateBusinessProfile(businessId, profile);
    revalidatePath(`/business/${encodeURIComponent(businessId)}/whatsapp`, "layout");
    return { ok: true, snapshot, message: "Saved. WhatsApp is showing your updated profile." };
  } catch (error) { return failure(error); }
}

export async function uploadProfilePicture(businessId: string, form: FormData, product?: string): Promise<ProfileActionResult> {
  try {
    if (product !== undefined) await requireProductWhatsAppBusiness(product, businessId, true);
    else await requireDashboardAccess(businessId);
    await loadBusiness(businessId);
    const file = form.get("picture");
    if (!(file instanceof Blob)) return { ok: false, message: "Choose an image." };
    const snapshot = await updateProfilePicture(businessId, new Uint8Array(await file.arrayBuffer()), file.type);
    revalidatePath(`/business/${encodeURIComponent(businessId)}/whatsapp`, "layout");
    return { ok: true, snapshot, message: "Profile picture updated." };
  } catch (error) { return failure(error); }
}

/** Re-reads everything from Meta; nothing is served from a local copy. */
export async function refreshBusinessProfile(businessId: string, product?: string): Promise<ProfileActionResult> {
  try {
    if (product !== undefined) await requireProductWhatsAppBusiness(product, businessId, true);
    else await requireDashboardAccess(businessId);
    await loadBusiness(businessId);
    return { ok: true, snapshot: await getBusinessProfile(businessId), message: "Refreshed from Meta." };
  } catch (error) { return failure(error); }
}
