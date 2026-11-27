"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceRoot } from "@/lib/admin/workspace-root";
import { canViewBusiness } from "./business-access";
import { workspaceProductContext, workspaceProductCookie } from "./workspace-product-context";

export async function switchWorkspaceProduct(businessId: string, requested: string): Promise<false> {
  if (!(await canViewBusiness(businessId))) return false;
  const { products } = await workspaceProductContext(businessId);
  const product = products.find(candidate => candidate === requested);
  if (!product) return false;
  const path = await workspaceRoot(businessId);
  (await cookies()).set(workspaceProductCookie, product, {
    path, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
  });
  redirect(path);
}
