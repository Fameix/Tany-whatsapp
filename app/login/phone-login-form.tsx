"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const resendSeconds = 60;

/** `business` set: a WhatsApp code from that business's own number, for that business only. */
export function PhoneLoginForm({ business = null }: { business?: { id: string; name: string } | null }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [wait, setWait] = useState(0);
  const scope = business ? { businessId: business.id } : {};

  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(seconds => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    const response = await fetch("/api/auth/phone/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ...scope }) });
    const result = await response.json() as { message?: string; retryAfter?: number };
    if (result.retryAfter) setWait(result.retryAfter);
    if (!response.ok) throw new Error(result.message ?? "We could not send a code right now.");
    setCodeSent(true);
    setWait(resendSeconds);
    setNotice(business ? `Code sent on WhatsApp from ${business.name}. It expires in five minutes.` : "Code sent. It expires in five minutes.");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setNotice("");
    try {
      if (!codeSent) { await sendCode(); return; }
      const response = await fetch("/api/auth/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code, ...scope }) });
      const result = await response.json() as { message?: string; location?: string };
      if (!response.ok) throw new Error(result.message ?? "Sign in could not be completed.");
      router.replace(result.location ?? "/dashboard"); router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Sign in could not be completed."); }
    finally { setBusy(false); }
  }

  async function resend() {
    setBusy(true); setNotice(""); setCode("");
    try { await sendCode(); } catch (error) { setNotice(error instanceof Error ? error.message : "We could not send a code right now."); }
    finally { setBusy(false); }
  }

  return <form className="mt-7 space-y-4" onSubmit={submit}>
    <label className="block text-sm font-medium text-slate-800" htmlFor="phone">{business ? "WhatsApp number" : "Phone number"}</label>
    <input id="phone" autoComplete="tel" inputMode="tel" required disabled={codeSent || busy} value={phone} onChange={event => setPhone(event.target.value)} placeholder="+919876543210" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-950 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50" />
    {codeSent && <div><label className="mb-2 block text-sm font-medium text-slate-800" htmlFor="code">6-digit code</label><input id="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 tracking-[0.3em] text-slate-950 outline-none focus:border-slate-600 focus:ring-2 focus:ring-slate-200" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => { setCodeSent(false); setCode(""); setNotice(""); }} className="text-slate-600 underline">Use a different number</button>
        <button type="button" onClick={resend} disabled={busy || wait > 0} className="text-slate-600 underline disabled:no-underline disabled:opacity-60">{wait > 0 ? `Resend code in ${wait}s` : "Resend code"}</button>
      </div></div>}
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{busy ? "Please wait…" : codeSent ? "Verify and continue" : business ? "Send code on WhatsApp" : "Send code"}</button>
  </form>;
}
