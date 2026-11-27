import "server-only";
import { cookies, headers } from "next/headers";
import { canIncludeStagingTestData, isLocalStaging } from "./staging-environment";

export const PRODUCT_TEST_DATA_COOKIE = "tany-admin-include-test-data";

export async function productTestDataPreference() {
  const host = (await headers()).get("host");
  const available = canIncludeStagingTestData(host);
  const include = available && (await cookies()).get(PRODUCT_TEST_DATA_COOKIE)?.value !== "off";
  return { available, include, local: isLocalStaging(host) };
}

export async function localStagingWorkspace() {
  return isLocalStaging((await headers()).get("host"));
}
