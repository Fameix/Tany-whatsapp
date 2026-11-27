import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getEnabledProducts } from "@/lib/subscriptions/entitlements";
import { selectWorkspaceProduct } from "@/lib/admin/workspace-products";
import { loadBusiness } from "./load-business";

export const workspaceProductCookie = "tany-workspace-product";

export const workspaceProductContext = cache(async (businessId: string) => {
  const [business, products, store] = await Promise.all([loadBusiness(businessId), getEnabledProducts(businessId), cookies()]);
  const product = selectWorkspaceProduct(products, business.vertical, store.get(workspaceProductCookie)?.value);
  return { business, product, products };
});
