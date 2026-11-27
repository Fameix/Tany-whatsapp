import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { PageHeader, ProductStatus, isSuperAdmin, surface } from "@/app/admin/components/control-center/ui";
import { tanyProducts } from "@/lib/messaging/vertical-config";

async function Products() {
  await connection();
  if (!(await isSuperAdmin())) return <DashboardAccessRequired />;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
      <PageHeader title="Products" description="Check product availability and manage live product workspaces." />
      <ul className={`${surface} divide-y divide-border/60 px-4 sm:px-5`}>
        {tanyProducts.map(product => (
          <li key={product.id} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
            {product.status === "live"
              ? <Link href={`/admin/products/${product.id}`} className="rounded-sm font-medium hover:underline">{product.name}</Link>
              : <span>{product.name}</span>}
            <ProductStatus status={product.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProductsPage() {
  return <Suspense fallback={<LoadingPanel />}><Products /></Suspense>;
}
