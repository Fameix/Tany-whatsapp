import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getAdminBusiness } from "@/lib/admin/services";
import { getPostgresBusinessProfile } from "@/lib/admin/postgres-directory";
import { databaseMode } from "@/lib/data/repository";
import { documentId } from "@/lib/messaging/services/shared";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";

export const loadBusiness = cache(async (businessId: string) => {
  if (process.env.NODE_ENV === "development")
    console.info("[LOAD_BUSINESS_START]", { businessId });
  try {
    documentId(businessId);
  } catch {
    notFound();
  }
  let business;
  try {
    // The Super Admin directory is Postgres-authoritative in dual-write mode.
    // Use the same tenant root for route resolution; runtime data is still read
    // from Firestore by the individual workspace services.
    business = ["dual-write", "postgres"].includes(databaseMode())
      ? await getPostgresBusinessProfile(businessId)
      : await getAdminBusiness(businessId);
  } catch (error) {
    if (process.env.NODE_ENV === "development") void error;
    throw error;
  }
  if (!business || !isActiveTanyVertical(business.vertical)) notFound();
  if (process.env.NODE_ENV === "development")
    console.info("[LOAD_BUSINESS_SUCCESS]", {
      businessId,
      vertical: business.vertical,
      active: business.active,
    });
  return business;
});
