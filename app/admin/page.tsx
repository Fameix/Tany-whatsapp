import { Suspense } from "react";
import { connection } from "next/server";
import { LoadingPanel } from "./components/shared";
import { DashboardAccessRequired } from "./components/dashboard-access-required";
import { PageHeader, ProductStatus, isSuperAdmin, surface } from "./components/control-center/ui";
import { ProductSelector } from "./components/control-center/product-selector";
import { OperationalDashboard } from "./components/control-center/operational-dashboard";
import { tanyProducts, isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { getOperationalOverview } from "@/lib/admin/operational-overview";

type Props = { searchParams: Promise<{ product?: string | string[] }> };

async function Overview({ searchParams }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <DashboardAccessRequired />;
  const query = await searchParams;
  const selected = tanyProducts.find(product => product.id === query.product);
  const liveProduct = isActiveTanyVertical(selected?.id) ? selected.id : null;
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 pb-6">
      <PageHeader title="Tany Super Admin" description="Monitor businesses, messaging and operations across Tany."
        action={<ProductSelector key={selected?.id ?? ""} product={selected?.id ?? ""} />} />
      {selected && !liveProduct ? (
        <section className={`${surface} space-y-3 p-5`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{selected.name}</h2>
            <ProductStatus status={selected.status} />
          </div>
          <p className="text-sm text-muted-foreground">This product is not live yet.</p>
        </section>
      ) : (
        <OperationalDashboard data={await getOperationalOverview(liveProduct)} allProducts={!selected} />
      )}
    </div>
  );
}

export default function AdminHome(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Overview {...props} /></Suspense>;
}
