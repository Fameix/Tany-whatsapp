import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { CalendarCheck, ShoppingBag, Utensils } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { BusinessTable, EmptyPanel, ProductStatus, isSuperAdmin, surface } from "@/app/admin/components/control-center/ui";
import {
  BusinessAttention, MessagingActivity, MessagingHealth, OperationalMetrics, RecentActivity,
} from "@/app/admin/components/control-center/operational-dashboard";
import { getOperationalOverview, type OperationalOverview } from "@/lib/admin/operational-overview";
import { isActiveTanyVertical, tanyProducts } from "@/lib/messaging/vertical-config";
import { productTestDataPreference } from "@/lib/admin/product-test-data";

type Props = { params: Promise<{ product: string }> };

const context = {
  motos: {
    description: "Monitor dealer messaging, customer conversations and test-drive bookings.",
    directory: "Dealer businesses",
    activity: "Test-drive bookings",
    total: "Recorded bookings",
    completed: "Completed",
    empty: "No test-drive bookings recorded.",
    icon: CalendarCheck,
  },
  eats: {
    description: "Monitor restaurant messaging, customer conversations and food orders.",
    directory: "Restaurant businesses",
    activity: "Food orders",
    total: "Recorded orders",
    completed: "Delivered",
    empty: "No food orders recorded.",
    icon: Utensils,
  },
  retail: {
    description: "Monitor retail messaging, customer conversations and shopping orders.",
    directory: "Retail businesses",
    activity: "Retail orders",
    total: "Recorded orders",
    completed: "Delivered",
    empty: "No retail orders recorded.",
    icon: ShoppingBag,
  },
};

const formatCount = new Intl.NumberFormat("en-IN");

function ProductActivity({ info, data }: { info: (typeof context)[keyof typeof context]; data: OperationalOverview["productActivity"] }) {
  const Icon = info.icon;
  return (
    <section aria-label={info.activity} className="rounded-xl bg-muted/55 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon aria-hidden="true" className="size-4 text-primary" />{info.activity}</h2>
        {data?.recorded ? <span className="text-xs text-muted-foreground">All time</span> : null}
      </div>
      {data?.recorded ? (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          <div><dt className="text-xs text-muted-foreground">{info.total}</dt><dd className="text-lg font-semibold tabular-nums">{formatCount.format(data.recorded)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{info.completed}</dt><dd className="text-lg font-semibold tabular-nums">{formatCount.format(data.completed)}</dd></div>
        </dl>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">{info.empty}</p>
      )}
    </section>
  );
}

async function ProductDetail({ params }: Props) {
  await connection();
  if (!(await isSuperAdmin())) return <DashboardAccessRequired />;
  const { product: id } = await params;
  const product = tanyProducts.find(candidate => candidate.id === id);
  if (!product) notFound();

  const liveProduct = isActiveTanyVertical(product.id) ? product.id : null;
  const info = liveProduct ? context[liveProduct] : null;
  const includeTestData = liveProduct ? (await productTestDataPreference()).include : false;
  const data = liveProduct ? await getOperationalOverview(liveProduct, { includeTestData }) : null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 pb-6">
      <header className={`${surface} grid items-center gap-4 p-4 sm:p-5 ${info ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" : ""}`}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <BrandLogo vertical={product.id} decorative className="size-12 sm:size-14" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
              <ProductStatus status={product.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{info?.description ?? "This product is not live yet."}</p>
          </div>
        </div>
        {info && data && <ProductActivity info={info} data={data.productActivity} />}
      </header>
      {data && info && (
        <>
          <OperationalMetrics data={{ ...data.metrics, businesses: data.directory.length }} product />
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <MessagingActivity days={data.days} title="Messaging activity" />
            <MessagingHealth data={data.health} />
          </div>
          <section aria-labelledby="product-businesses" className="min-w-0 space-y-3">
            <h2 id="product-businesses" className="text-sm font-semibold tracking-tight">{info.directory}</h2>
            {data.directory.length
              ? <BusinessTable businesses={data.directory} showProduct={false} openLabel="Open workspace" />
              : <EmptyPanel title={`No ${includeTestData ? "" : "live "}${product.name} businesses yet`} detail="Business workspaces will appear here as they are added to this product." />}
          </section>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <BusinessAttention items={data.attention} />
            <RecentActivity items={data.activity} />
          </div>
        </>
      )}
    </div>
  );
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><ProductDetail {...props} /></Suspense>;
}
