import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ChevronRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LoadingPanel } from "@/app/admin/components/shared";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { PageHeader, ProductStatus } from "@/app/admin/components/control-center/ui";
import { Surface } from "@/app/business/_components/home/home-primitives";
import { tanyProducts } from "@/lib/messaging/vertical-config";
import { adminProductPath } from "@/lib/admin/product-routes";

/** All 12 products as simple cards; live products first. */
async function Products() {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const ordered = [...tanyProducts.filter(p => p.status === "live"), ...tanyProducts.filter(p => p.status !== "live")];
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <PageHeader title="Products" description="Every Tany product. Live products are available to businesses today." />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map(product => {
          const live = product.status === "live";
          return (
            <li key={product.id}>
              <Link href={adminProductPath(product.id)} className="group block h-full rounded-xl focus-visible:outline-offset-2" aria-label={`${product.name}, ${live ? "live" : "coming soon"}`}>
                <Surface className={`flex h-full flex-col gap-4 p-4 transition-shadow group-hover:shadow-[0_2px_8px_rgb(9_9_11/0.06),0_0_0_1px_rgb(9_9_11/0.08)] ${live ? "" : "opacity-75"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <BrandLogo vertical={product.id} decorative />
                    <ProductStatus status={product.status} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{product.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{live ? "Businesses, WhatsApp and messaging" : "Not yet available to businesses"}</p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                    {live ? "Open product" : "View"}<ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Surface>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function ProductsPage() {
  return <Suspense fallback={<LoadingPanel />}><Products /></Suspense>;
}
