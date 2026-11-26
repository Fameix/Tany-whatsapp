import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { resolveDashboardSession } from "@/lib/admin/dashboard-access";
import { dashboardSessionCookieName } from "@/lib/admin/dashboard-cookie";
import { getClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import type { ClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { embeddedSignupClientConfiguration } from "@/lib/whatsapp/embedded-signup-service";
import { verifyWhatsAppSetupSession, whatsappSetupSessionCookieName } from "@/lib/admin/whatsapp-setup-session";
import { WhatsAppConnection } from "../_components/whatsapp-connection";
import "@/app/admin/admin.css";

async function ClientSetup({ searchParams }: { searchParams: Promise<{ businessId?: string | string[] }> }) {
  await connection();
  const store = await cookies();
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  const query = await searchParams;
  const requestedBusinessId = typeof query.businessId === "string" ? query.businessId : "";
  let businessId = "";
  if (requestedBusinessId) {
    const setupCredential = store.get(whatsappSetupSessionCookieName)?.value ?? "";
    if (!(await verifyWhatsAppSetupSession(secret, setupCredential, requestedBusinessId))) redirect("/dashboard");
    businessId = requestedBusinessId;
  } else {
    const session = await resolveDashboardSession(secret, store.get(dashboardSessionCookieName)?.value ?? "");
    if (session?.role !== "business") redirect("/dashboard");
    businessId = session.businessId;
  }
  const clientConnection: ClientWhatsAppConnection = await getClientWhatsAppConnection(businessId);
  const dashboardHref = `/business/${encodeURIComponent(businessId)}/whatsapp`;
  if (clientConnection?.status === "connected" && clientConnection.health === "verified") redirect(dashboardHref);
  return <main className="tany-admin flex min-h-svh items-center justify-center bg-muted/30 p-4 sm:p-6"><WhatsAppConnection initialConnection={clientConnection} embeddedSignup={embeddedSignupClientConfiguration()} dashboardHref={dashboardHref} businessId={businessId} /></main>;
}

export default function Page(props: { searchParams: Promise<{ businessId?: string | string[] }> }) {
  return <Suspense fallback={<main className="tany-admin flex min-h-svh items-center justify-center p-6"><p className="text-sm text-muted-foreground">Opening WhatsApp setup…</p></main>}><ClientSetup searchParams={props.searchParams} /></Suspense>;
}
