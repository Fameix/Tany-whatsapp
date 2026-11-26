import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/admin/dashboard-session";
async function Workspace() {
  await connection();
  let session;
  try { session = await getDashboardSession(); }
  catch { return redirect("/login"); }
  return redirect(session.role === "business" ? `/business/${encodeURIComponent(session.businessId)}` : session.role === "selector" ? "/dashboard/select-business" : "/admin");
}
export default function Page() { return <Suspense fallback={<p>Opening your WhatsApp workspace…</p>}><Workspace /></Suspense>; }
