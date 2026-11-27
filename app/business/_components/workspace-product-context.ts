import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getEnabledProducts } from "@/lib/subscriptions/entitlements";
import { selectWorkspaceProduct } from "@/lib/admin/workspace-products";
import { workspaceProductFor } from "@/lib/admin/product-workspace";
import { isWorkspaceAlias } from "@/lib/admin/workspace-root";
import { loadBusiness } from "./load-business";

export const workspaceProductCookie = "tany-workspace-product";

export const workspaceProductContext = cache(async (businessId: string) => {
  // Super Admin → <product> shows that product's workspace (its tools included), whatever the
  // staging tenant's subscription; Super Admin access is already verified for the alias.
  const aliasProduct = (await isWorkspaceAlias()) ? workspaceProductFor(businessId) : null;
  if (aliasProduct) return { business: await loadBusiness(businessId), product: aliasProduct, products: [aliasProduct] };
  const [business, products, store] = await Promise.all([loadBusiness(businessId), getEnabledProducts(businessId), cookies()]);
  const product = selectWorkspaceProduct(products, business.vertical, store.get(workspaceProductCookie)?.value);
  return { business, product, products };
});
