import { Suspense } from "react";
import { connection } from "next/server";
import { businessLoginName } from "@/lib/admin/phone-login-service";
import { PhoneLoginForm } from "./phone-login-form";

type Props = { searchParams: Promise<{ business?: string | string[] }> };

/** /login?business=<id> signs in to that one business with a WhatsApp code from its own number;
 * plain /login keeps the original SMS sign-in. */
async function Login({ searchParams }: Props) {
  await connection();
  const requested = (await searchParams).business;
  const businessId = typeof requested === "string" ? requested : "";
  const businessName = businessId ? await businessLoginName(businessId).catch((error: unknown) => {
    console.error("[LOGIN_BUSINESS_LOOKUP_FAILED]", error instanceof Error ? error.message : "unknown");
    return null;
  }) : null;
  const business = businessId && businessName ? { id: businessId, name: businessName } : null;
  return <>
    <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{business ? `Sign in to ${business.name}` : "Sign in with your phone"}</h1>
    <p className="mt-2 text-sm leading-6 text-slate-600">{business
      ? `We’ll send a one-time code on WhatsApp from ${business.name}’s WhatsApp number.`
      : businessId ? "This sign-in link isn’t available. Check the link, or sign in with your phone below." : "We’ll send a one-time code to the phone number linked to your workspace."}</p>
    <PhoneLoginForm business={business} />
  </>;
}

export default function LoginPage(props: Props) {
  return <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">Tany Messaging</p>
      <Suspense fallback={<p className="mt-2 text-sm text-slate-500">Loading…</p>}><Login {...props} /></Suspense>
    </section>
  </main>;
}
