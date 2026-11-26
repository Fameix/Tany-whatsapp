"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PhoneLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      const response = await fetch(codeSent ? "/api/auth/phone/verify" : "/api/auth/phone/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(codeSent ? { phone, code } : { phone }),
      });
      const result = await response.json() as { message?: string; location?: string };
      if (!response.ok) throw new Error(result.message ?? "Sign in could not be completed.");
      if (codeSent) { router.replace(result.location ?? "/dashboard"); router.refresh(); }
      else { setCodeSent(true); setNotice("Code sent. It expires in five minutes."); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Sign in could not be completed."); }
    finally { setBusy(false); }
  }

  return <form className="mt-7 space-y-4" onSubmit={submit}>
    <label className="block text-sm font-medium text-slate-800" htmlFor="phone">Phone number</label>
    <input id="phone" autoComplete="tel" inputMode="tel" required disabled={codeSent || busy} value={phone} onChange={event => setPhone(event.target.value)} placeholder="+919876543210" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50" />
    {codeSent && <div><label className="mb-2 block text-sm font-medium text-slate-800" htmlFor="code">6-digit code</label><input id="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 tracking-[0.3em] text-slate-950 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-200" />
      <button type="button" onClick={() => { setCodeSent(false); setCode(""); setNotice(""); }} className="mt-2 text-sm text-slate-600 underline">Use a different number</button></div>}
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{busy ? "Please wait…" : codeSent ? "Verify and continue" : "Send code"}</button>
  </form>;
}
