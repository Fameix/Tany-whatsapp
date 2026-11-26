"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Business = { id: string; name: string };
export function SelectBusiness() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => { void fetch("/api/auth/phone/select-business", { cache: "no-store" }).then(async response => {
    const result = await response.json() as { businesses?: Business[]; message?: string };
    if (!response.ok) throw new Error(result.message ?? "Business list unavailable.");
    setBusinesses(result.businesses ?? []);
  }).catch(reason => setError(reason instanceof Error ? reason.message : "Business list unavailable.")); }, []);
  async function choose(businessId: string) {
    setBusy(businessId); setError("");
    try {
      const response = await fetch("/api/auth/phone/select-business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId }) });
      const result = await response.json() as { location?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Business unavailable.");
      router.replace(result.location ?? "/dashboard"); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Business unavailable."); setBusy(""); }
  }
  return <div className="mt-7 space-y-3">{businesses.map(business => <button key={business.id} disabled={!!busy} onClick={() => void choose(business.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 text-left hover:border-slate-400 disabled:opacity-60"><span><span className="block font-medium text-slate-900">{business.name}</span><span className="mt-1 block text-xs text-slate-500">{business.id}</span></span><span className="text-sm text-slate-500">{busy === business.id ? "Opening…" : "Open"}</span></button>)}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
