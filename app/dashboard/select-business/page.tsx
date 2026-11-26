import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/admin/dashboard-session";
import { SelectBusiness } from "./select-business";

async function WorkspaceSelector() {
  await connection();
  let session;
  try { session = await getDashboardSession(); }
  catch { redirect("/login"); }
  if (session.role === "admin") redirect("/admin");
  if (session.role === "business") redirect(`/business/${encodeURIComponent(session.businessId)}`);
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-16">
    <p className="text-sm font-semibold text-slate-500">Tany Messaging</p>
    <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Choose a business</h1>
    <p className="mt-2 text-sm text-slate-600">Select the workspace you want to open.</p>
    <SelectBusiness />
  </main>;
}

export default function SelectBusinessPage() {
  return <Suspense fallback={<main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-16"><p className="text-sm text-slate-500">Loading workspaces…</p></main>}><WorkspaceSelector /></Suspense>;
}
