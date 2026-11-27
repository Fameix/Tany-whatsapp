"use server";

import { cookies } from "next/headers";
import { requireDashboardAccess } from "@/lib/admin/dashboard-session";
import { PRODUCT_TEST_DATA_COOKIE, productTestDataPreference } from "@/lib/admin/product-test-data";

export async function setIncludeTestData(form: FormData) {
  if (await requireDashboardAccess() !== "admin") return;
  const { available, local } = await productTestDataPreference();
  const value = form.get("includeTestData");
  if (!available || (value !== "on" && value !== "off")) return;
  (await cookies()).set(PRODUCT_TEST_DATA_COOKIE, value, {
    path: "/admin",
    sameSite: "lax",
    httpOnly: true,
    secure: !local,
  });
}
