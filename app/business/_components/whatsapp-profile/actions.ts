"use server";
import { revalidatePath } from "next/cache";
import { DashboardAuthorizationError, requireDashboardAccess } from "@/lib/admin/dashboard-session";
import { loadBusiness } from "@/app/business/_components/load-business";
import { BusinessProfileError, updateBusinessProfile, updateProfilePicture } from "@/lib/whatsapp/business-profile";
import type { BusinessProfile, EditableProfile } from "@/lib/whatsapp/business-profile-model";

export type ProfileActionResult = { ok: true; profile: BusinessProfile; message: string } | { ok: false; message: string };

function failure(error: unknown): ProfileActionResult {
  if (error instanceof DashboardAuthorizationError) return { ok: false, message: "You don't have access to this business." };
  if (error instanceof BusinessProfileError) return { ok: false, message: error.message };
  console.error("[WHATSAPP_PROFILE_ACTION_FAILED]", { error: error instanceof Error ? error.name : typeof error });
  return { ok: false, message: "Something went wrong. Please try again." };
}

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export async function saveBusinessProfile(businessId: string, input: unknown): Promise<ProfileActionResult> {
  try {
    await requireDashboardAccess(businessId);
    await loadBusiness(businessId);
    const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const profile: EditableProfile = {
      about: str(value.about, 200), description: str(value.description, 600), email: str(value.email, 200).trim(), address: str(value.address, 300),
      websites: Array.isArray(value.websites) ? value.websites.slice(0, 3).map(site => str(site, 300).trim()).filter(Boolean) : [],
      vertical: str(value.vertical, 40) as EditableProfile["vertical"],
    };
    const { profile: saved } = await updateBusinessProfile(businessId, profile);
    revalidatePath(`/business/${encodeURIComponent(businessId)}/whatsapp`, "layout");
    return { ok: true, profile: saved, message: "Saved. WhatsApp is showing your updated profile." };
  } catch (error) { return failure(error); }
}

export async function uploadProfilePicture(businessId: string, form: FormData): Promise<ProfileActionResult> {
  try {
    await requireDashboardAccess(businessId);
    await loadBusiness(businessId);
    const file = form.get("picture");
    if (!(file instanceof Blob)) return { ok: false, message: "Choose an image." };
    const { profile } = await updateProfilePicture(businessId, new Uint8Array(await file.arrayBuffer()), file.type);
    revalidatePath(`/business/${encodeURIComponent(businessId)}/whatsapp`, "layout");
    return { ok: true, profile, message: "Profile picture updated." };
  } catch (error) { return failure(error); }
}
