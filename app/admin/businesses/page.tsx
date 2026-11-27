import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingPanel } from "@/app/admin/components/shared";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { BusinessTable, EmptyPanel, HiddenTenantsNote, PageHeader } from "@/app/admin/components/control-center/ui";
import { listProductBusinesses, realBusinesses } from "@/lib/admin/product-center";

/** Real businesses across all products. Test, demo and migration tenants live in Test & staging. */
async function Directory() {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  const all = await listProductBusinesses();
  const businesses = realBusinesses(all);
  return (
    <div className="flex flex-col gap-3">
      {businesses.length
        ? <BusinessTable businesses={businesses} actions={business => <Link href={`/admin/businesses/${encodeURIComponent(business.id)}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">Profile</Link>} />
        : <EmptyPanel title="No businesses yet" detail="Real businesses appear here once they're created. Test, demo and migration tenants are listed in Test & staging." />}
      <HiddenTenantsNote count={all.length - businesses.length} href="/admin/system" />
    </div>
  );
}

export default function BusinessesPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <PageHeader title="Businesses" description="Every business using a Tany product."
        action={<Button asChild size="sm"><Link href="/admin/businesses/new"><Plus />New business</Link></Button>} />
      <Suspense fallback={<LoadingPanel />}><Directory /></Suspense>
    </div>
  );
}
