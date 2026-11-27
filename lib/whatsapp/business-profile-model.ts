/** WhatsApp Business Profile fields the Cloud API supports. Pure: shared by the editor and server. */

export const profileVerticals = [
  ["UNDEFINED", "Not set"], ["AUTO", "Automotive"], ["BEAUTY", "Beauty, spa and salon"], ["APPAREL", "Clothing and apparel"],
  ["EDU", "Education"], ["ENTERTAIN", "Entertainment"], ["EVENT_PLAN", "Event planning and service"], ["FINANCE", "Finance and banking"],
  ["GROCERY", "Food and grocery"], ["GOVT", "Public service"], ["HOTEL", "Hotel and lodging"], ["HEALTH", "Medical and health"],
  ["NONPROFIT", "Non-profit"], ["PROF_SERVICES", "Professional services"], ["RETAIL", "Shopping and retail"], ["TRAVEL", "Travel and transportation"],
  ["RESTAURANT", "Restaurant"], ["OTHER", "Other"],
] as const;
export type ProfileVertical = (typeof profileVerticals)[number][0];

export type BusinessProfile = {
  about: string;
  description: string;
  email: string;
  address: string;
  websites: string[];
  vertical: ProfileVertical;
  profilePictureUrl: string;
};
export type EditableProfile = Omit<BusinessProfile, "profilePictureUrl">;

export type DisplayNameStatus = "approved" | "pending" | "rejected" | "unknown";
export type QualityRating = "high" | "medium" | "low" | "unknown";
/** Meta is the source of truth for all of this; Tany never stores a copy of the display name. */
export type DisplayName = { name: string; phone: string; status: DisplayNameStatus; quality: QualityRating };

/** Read-only diagnostics from one fresh Meta read. */
export type ProfileDiagnostics = { phoneNumberId: string; wabaId: string; refreshedAt: string };

/** Meta's phone-number quality_rating; Unknown when Meta doesn't report one. */
export function qualityRating(value: unknown): QualityRating {
  const rating = String(value ?? "").toUpperCase();
  return rating === "GREEN" ? "high" : rating === "YELLOW" ? "medium" : rating === "RED" ? "low" : "unknown";
}

/** Customer-facing profile checklist, separate from display-name approval. */
export function profileChecklist(profile: BusinessProfile) {
  return [
    { label: "Profile picture", complete: !!profile.profilePictureUrl },
    { label: "About", complete: !!profile.about.trim() },
    { label: "Description", complete: !!profile.description.trim() },
    { label: "Category", complete: profile.vertical !== "UNDEFINED" },
    { label: "Email", complete: !!profile.email.trim() },
    { label: "Website", complete: profile.websites.length > 0 },
    { label: "Address", complete: !!profile.address.trim() },
  ];
}

/** Limits from the Cloud API business profile reference. */
export const profileLimits = { about: 139, description: 512, email: 128, address: 256, website: 256, websites: 2 };
export const pictureLimits = { maxBytes: 5 * 1024 * 1024, minSide: 192, types: ["image/jpeg", "image/png"] as const };

export type ProfileIssue = { field: keyof EditableProfile; message: string };

export function validateProfile(profile: EditableProfile): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  if (!profile.about.trim()) issues.push({ field: "about", message: "Add a short About line. WhatsApp shows it under your name." });
  if (profile.about.length > profileLimits.about) issues.push({ field: "about", message: `Keep About under ${profileLimits.about} characters.` });
  if (profile.description.length > profileLimits.description) issues.push({ field: "description", message: `Keep the description under ${profileLimits.description} characters.` });
  if (profile.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) || profile.email.length > profileLimits.email)) issues.push({ field: "email", message: "Enter a valid email address." });
  if (profile.address.length > profileLimits.address) issues.push({ field: "address", message: `Keep the address under ${profileLimits.address} characters.` });
  if (profile.websites.length > profileLimits.websites) issues.push({ field: "websites", message: "Add at most two websites." });
  for (const site of profile.websites)
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/.test(site) || site.length > profileLimits.website) issues.push({ field: "websites", message: `"${site}" isn't a valid website. Start it with https://` });
  if (!profileVerticals.some(([value]) => value === profile.vertical)) issues.push({ field: "vertical", message: "Choose a category." });
  return issues;
}

/** Fields Meta needs for a complete profile; used for the optional onboarding nudge. */
export const isProfileIncomplete = (profile: BusinessProfile) => !profile.about.trim() || !profile.description.trim() || !profile.profilePictureUrl || profile.vertical === "UNDEFINED";

/** Maps Meta's name_status to Tany's display-name lifecycle. */
export function displayNameStatus(value: unknown): DisplayNameStatus {
  const status = String(value ?? "").toUpperCase();
  if (status === "APPROVED" || status === "AVAILABLE_WITHOUT_REVIEW") return "approved";
  if (status === "PENDING_REVIEW") return "pending";
  if (status === "DECLINED" || status === "EXPIRED") return "rejected";
  return "unknown";
}

/** Width and height of a PNG or JPEG from its bytes, without decoding the image. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      // Start-of-frame markers carry the dimensions (SOF0–SOF15, excluding DHT/JPG/DAC).
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
      offset += 2 + length;
    }
  }
  return null;
}

export function validatePicture(bytes: Uint8Array, type: string): string | null {
  if (!(pictureLimits.types as readonly string[]).includes(type)) return "Use a JPG or PNG image.";
  if (!bytes.length) return "Choose an image.";
  if (bytes.length > pictureLimits.maxBytes) return "Use an image under 5 MB.";
  const size = imageDimensions(bytes);
  if (!size) return "This image couldn't be read. Try another JPG or PNG.";
  if (size.width !== size.height) return "The profile picture must be square.";
  if (size.width < pictureLimits.minSide) return `Use an image at least ${pictureLimits.minSide}×${pictureLimits.minSide} pixels.`;
  return null;
}
