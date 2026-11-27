import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { productTestDataPreference } from "@/lib/admin/product-test-data";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { TestDataControl } from "@/app/admin/components/control-center/test-data-control";

export async function generateMetadata({ params }: { params: Promise<{ product: string }> }): Promise<Metadata> {
  const { product } = await params;
  const definition = tanyProducts.find(item => item.id === product);
  return definition ? { title: `${definition.name} Admin` } : {};
}

async function ProductTestControl({ params }: { params: Promise<{ product: string }> }) {
  await connection();
  const { product } = await params;
  if (!isActiveTanyVertical(product) || !(await isSuperAdmin())) return null;
  const { available, include } = await productTestDataPreference();
  return available ? <TestDataControl included={include} /> : null;
}

export default function ProductLayout({ children, params }: { children: React.ReactNode; params: Promise<{ product: string }> }) {
  return <>
    <Suspense fallback={null}><ProductTestControl params={params} /></Suspense>
    {children}
  </>;
}
