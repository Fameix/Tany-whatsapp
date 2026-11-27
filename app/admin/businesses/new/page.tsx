import { isSuperAdmin } from "@/lib/admin/super-admin-session";
import { SuperAdminSignInRequired } from "@/app/admin/components/super-admin-sign-in-required";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoadingPanel } from "@/app/admin/components/shared";

import { BusinessForm } from "@/app/admin/components/business-form";

async function NewBusiness() {
  await connection();
  if (!(await isSuperAdmin())) return <SuperAdminSignInRequired />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/admin/businesses"
        className="inline-flex text-xs text-muted-foreground hover:text-foreground"
      >
        ← Businesses
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New business</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Set up a business profile. You can add its catalog next.
        </p>
      </div>
      <BusinessForm />
    </div>
  );
}

export default function NewBusinessPage() {
  return <Suspense fallback={<LoadingPanel />}><NewBusiness /></Suspense>;
}
