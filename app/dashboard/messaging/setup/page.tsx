import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { verifyWhatsAppSetupSession, whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { businessWhatsAppSetupPath } from "@/lib/admin/whatsapp-setup-access";
import "@/app/admin/admin.css";

async function ClientSetup({ searchParams }: { searchParams: Promise<{ businessId?: string | string[] }> }) {
  await connection();
  const store = await cookies();
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const session = await resolveDashboardSession(secret, store.get(dashboardSessionCookieName)?.value ?? "");
  const query = await searchParams;
  const requestedBusinessId = typeof query.businessId === "string" ? query.businessId : "";
  let businessId = "";
  if (requestedBusinessId) {
    const setupCredential = store.get(whatsappSetupSessionCookieName)?.value ?? "";
    if (!(await verifyWhatsAppSetupSession(secret, setupCredential, requestedBusinessId))) redirect("/dashboard");
    if (session?.role === "business" && session.businessId !== requestedBusinessId) redirect("/dashboard");
    businessId = requestedBusinessId;
  } else {
    if (session?.role !== "business") redirect("/dashboard");
    businessId = session.businessId;
  }
  return redirect(businessWhatsAppSetupPath(businessId));
}

export default function Page(props: { searchParams: Promise<{ businessId?: string | string[] }> }) {
  return <Suspense fallback={<main className="tany-admin flex min-h-svh items-center justify-center p-6"><p className="text-sm text-muted-foreground">Opening WhatsApp setup…</p></main>}><ClientSetup searchParams={props.searchParams} /></Suspense>;
}
