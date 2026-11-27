import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAdminBusiness } from "@/lib/admin/services";
import { getPostgresBusinessProfile } from "@/lib/admin/postgres-directory";
import { databaseMode } from "@/lib/data/repository";
import { documentId } from "@/lib/messaging/services/shared";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { classifyTenant, hasFixtureWorkspaceId } from "@/lib/admin/tenant-classification";
import { canIncludeStagingTestData } from "@/lib/admin/staging-environment";

export const loadBusiness = cache(async (businessId: string) => {
  if (process.env.NODE_ENV === "development")
    console.info("[LOAD_BUSINESS_START]", { businessId });
  try {
    documentId(businessId);
  } catch {
    notFound();
  }
  const allowsFixtures = canIncludeStagingTestData((await headers()).get("host"));
  if (!allowsFixtures && hasFixtureWorkspaceId(businessId)) notFound();
  const business = ["dual-write", "postgres"].includes(databaseMode())
    ? await getPostgresBusinessProfile(businessId)
    : await getAdminBusiness(businessId);
  if (!business || !isActiveTanyVertical(business.vertical)) notFound();
  const kind = "tenantKind" in business ? business.tenantKind : classifyTenant(business);
  if (!allowsFixtures && kind !== "live") notFound();
  if (process.env.NODE_ENV === "development")
    console.info("[LOAD_BUSINESS_SUCCESS]", {
      businessId,
      vertical: business.vertical,
      active: business.active,
    });
  return business;
});
