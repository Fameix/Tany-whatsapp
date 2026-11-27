"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, ChevronDown, Circle, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/app/business/_components/home/home-primitives";
import { pictureLimits, profileChecklist, profileLimits, profileVerticals, validateProfile, type BusinessProfile, type EditableProfile } from "@/lib/whatsapp/business-profile-model";
import type { ProfileSnapshot } from "@/lib/whatsapp/business-profile";
import { refreshBusinessProfile, saveBusinessProfile, uploadProfilePicture } from "./actions";

const surface = "rounded-xl bg-card shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)]";
const fieldClass = "w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className={cn(surface, "flex flex-col gap-4 p-4 sm:p-6")}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, count, children }: { label: string; hint?: string; count?: [number, number]; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium">
      <span className="flex items-center justify-between gap-2">{label}{count && <span className={cn("font-normal tabular-nums", count[0] > count[1] ? "text-primary" : "text-muted-foreground")}>{count[0]}/{count[1]}</span>}</span>
      {children}
      {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

const nameStatus = {
  approved: { label: "Approved by Meta", className: "bg-emerald-500/10 text-emerald-800" },
  pending: { label: "Under Meta review", className: "bg-amber-500/10 text-amber-800" },
  rejected: { label: "Rejected by Meta", className: "bg-primary/10 text-primary" },
  unknown: { label: "Status unknown", className: "bg-muted text-muted-foreground" },
} as const;
const qualityLabel = { high: "High", medium: "Medium", low: "Low", unknown: "Not reported" } as const;
const editable = (profile: BusinessProfile): EditableProfile => ({ about: profile.about, description: profile.description, email: profile.email, address: profile.address, websites: profile.websites, vertical: profile.vertical });
const refreshedAt = (iso: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** Center-crops to a square JPEG so WhatsApp shows the picture exactly as previewed. */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("unreadable")); img.src = url; });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side < pictureLimits.minSide) throw new Error(`Use an image at least ${pictureLimits.minSide}×${pictureLimits.minSide} pixels.`);
    const output = Math.min(640, side);
    const canvas = document.createElement("canvas");
    canvas.width = output; canvas.height = output;
    canvas.getContext("2d")!.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, output, output);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("unreadable"))), "image/jpeg", 0.9));
  } finally { URL.revokeObjectURL(url); }
}

const emptyProfile: BusinessProfile = { about: "", description: "", email: "", address: "", websites: [], vertical: "UNDEFINED", profilePictureUrl: "" };

export function ProfileEditor({ businessId, initial, managerUrl, product, stagingHref, storedAccount }: {
  businessId: string;
  initial: ProfileSnapshot | null;
  managerUrl?: string;
  product?: string;
  stagingHref?: string;
  storedAccount?: { displayName: string; phone: string | null; status: string };
}) {
  // Meta is the source of truth: every save, upload or refresh replaces this with Meta's latest read.
  const [snapshot, setSnapshot] = useState(initial);
  const saved = snapshot?.profile ?? emptyProfile;
  const displayName = snapshot?.displayName ?? { name: storedAccount?.displayName ?? "", phone: storedAccount?.phone ?? "", status: "unknown" as const, quality: "unknown" as const };
  const diagnostics = snapshot?.diagnostics;
  const [draft, setDraft] = useState<EditableProfile>(() => editable(initial?.profile ?? emptyProfile));
  const readOnly = !snapshot || !!stagingHref;
  const connectionStatus = snapshot ? "Connected" : storedAccount?.status ?? "Not available";
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [picture, setPicture] = useState<{ blob: Blob; url: string } | null>(null);
  const [pictureStep, setPictureStep] = useState<"" | "preparing" | "uploading">("");
  const fileInput = useRef<HTMLInputElement>(null);
  const issues = validateProfile(draft);
  const websites = [draft.websites[0] ?? "", draft.websites[1] ?? ""];
  const dirty = JSON.stringify(draft) !== JSON.stringify({ about: saved.about, description: saved.description, email: saved.email, address: saved.address, websites: saved.websites, vertical: saved.vertical });
  const update = (patch: Partial<EditableProfile>) => { setDraft(current => ({ ...current, ...patch })); setMessage(null); };
  const issueFor = (field: keyof EditableProfile) => issues.find(issue => issue.field === field)?.message;

  const accept = (next: ProfileSnapshot, text: string) => {
    setSnapshot(next);
    setDraft(editable(next.profile));
    setMessage({ tone: "ok", text });
  };
  const save = () => startTransition(async () => {
    const result = await saveBusinessProfile(businessId, draft, product);
    if (result.ok) accept(result.snapshot, result.message); else setMessage({ tone: "error", text: result.message });
  });
  const refresh = () => startTransition(async () => {
    setRefreshing(true);
    const result = await refreshBusinessProfile(businessId, product);
    setRefreshing(false);
    if (!result.ok) return setMessage({ tone: "error", text: result.message });
    // Meta's fresh read replaces everything shown; unsaved edits are kept only if there are some.
    setSnapshot(result.snapshot);
    if (!dirty) setDraft(editable(result.snapshot.profile));
    setMessage({ tone: "ok", text: result.message });
  });
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    if (!(pictureLimits.types as readonly string[]).includes(file.type)) return setMessage({ tone: "error", text: "Use a JPG or PNG image." });
    if (file.size > pictureLimits.maxBytes) return setMessage({ tone: "error", text: "Use an image under 5 MB." });
    setPictureStep("preparing");
    try {
      const blob = await squareJpeg(file);
      if (picture) URL.revokeObjectURL(picture.url);
      setPicture({ blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error && error.message !== "unreadable" ? error.message : "This image couldn't be read. Try another JPG or PNG." });
    } finally { setPictureStep(""); }
  };
  const upload = () => startTransition(async () => {
    if (!picture) return;
    setPictureStep("uploading");
    const form = new FormData();
    form.append("picture", new File([picture.blob], "profile.jpg", { type: "image/jpeg" }));
    const result = await uploadProfilePicture(businessId, form, product);
    setPictureStep("");
    if (result.ok) { URL.revokeObjectURL(picture.url); setPicture(null); accept(result.snapshot, result.message); }
    else setMessage({ tone: "error", text: result.message });
  });

  const avatar = picture?.url ?? saved.profilePictureUrl;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-24">
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Business Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage how your business appears to customers on WhatsApp.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={pending || readOnly}>
            {refreshing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
            Refresh from Meta
          </Button>
          {(stagingHref || managerUrl) && <a href={stagingHref ?? managerUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted">
            {stagingHref ? "Open profile on staging" : "Open in WhatsApp Manager"}<ExternalLink className="size-3.5" aria-hidden="true" />
          </a>}
        </div>
      </div>

      <div className={cn(surface, "flex items-center gap-4 p-4 sm:p-6")}>
        <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element -- Meta-hosted profile image */}
          {avatar ? <img src={avatar} alt="WhatsApp profile picture" className="size-full object-cover" /> : (displayName.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{displayName.name || "Display name not set"}</p>
          <p className="truncate text-sm text-muted-foreground tabular-nums">{displayName.phone}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><StatusDot tone={connectionStatus === "Connected" ? "success" : "neutral"} />{connectionStatus}</p>
        </div>
      </div>

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm", message.tone === "error" ? "bg-primary/8 text-primary" : "bg-emerald-500/10 text-emerald-800")}>{message.text}</p>}
      {stagingHref && <p className="text-sm text-muted-foreground">Profile details and updates require staging. The fields below are a read-only preview.</p>}

      <fieldset disabled={readOnly} className="contents">
      <Section title="Business details">
        <Field label="About" hint="Short status shown under your name." count={[draft.about.length, profileLimits.about]}>
          <Input value={draft.about} maxLength={profileLimits.about + 20} onChange={e => update({ about: e.target.value })} aria-invalid={!!issueFor("about")} />
        </Field>
        <Field label="Description" count={[draft.description.length, profileLimits.description]}>
          <textarea rows={4} value={draft.description} maxLength={profileLimits.description + 50} onChange={e => update({ description: e.target.value })} className={cn(fieldClass, "py-2 leading-6")} placeholder="What your business offers" />
        </Field>
        <Field label="Category">
          <select className={cn(fieldClass, "h-9")} value={draft.vertical} onChange={e => update({ vertical: e.target.value as EditableProfile["vertical"] })}>
            {profileVerticals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Contact information">
        <Field label="Email"><Input type="email" value={draft.email} maxLength={profileLimits.email} onChange={e => update({ email: e.target.value.trim() })} placeholder="hello@yourbusiness.com" /></Field>
        <Field label="Address" count={[draft.address.length, profileLimits.address]}><Input value={draft.address} maxLength={profileLimits.address + 20} onChange={e => update({ address: e.target.value })} placeholder="Street, city, PIN" /></Field>
      </Section>

      <Section title="Online presence" description="Up to two websites.">
        {websites.map((site, index) => (
          <Field key={index} label={index ? "Second website" : "Website"}>
            <Input value={site} maxLength={profileLimits.website} placeholder="https://" onChange={e => { const next = [...websites]; next[index] = e.target.value.trim(); update({ websites: next.filter(Boolean) }); }} />
          </Field>
        ))}
      </Section>

      <Section title="Profile picture" description="JPG or PNG, at least 192×192. It's cropped to a square.">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview or Meta-hosted image */}
            {avatar ? <img src={avatar} alt="Profile picture preview" className="size-full object-cover" /> : <Camera className="size-6" aria-hidden="true" />}
          </span>
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="Choose profile picture" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
            <Button type="button" variant="outline" size="sm" disabled={pending || pictureStep !== ""} onClick={() => fileInput.current?.click()}>
              {pictureStep === "preparing" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {saved.profilePictureUrl || picture ? "Replace picture" : "Upload picture"}
            </Button>
            {picture && (
              <Button type="button" size="sm" onClick={upload} disabled={pending}>
                {pictureStep === "uploading" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {pictureStep === "uploading" ? "Updating WhatsApp…" : "Use this picture"}
              </Button>
            )}
          </div>
        </div>
        {picture && <p className="text-xs text-muted-foreground">Preview only. Your WhatsApp picture changes after you choose &ldquo;Use this picture&rdquo;.</p>}
      </Section>

      </fieldset>
      <Section title="Display name" description="The name customers see on WhatsApp. Meta reviews it; Tany shows Meta's current record.">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Display name</p>
            <p className="truncate text-base font-semibold">{displayName.name || "Not set"}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Meta review status</p>
            <span className={cn("mt-1 inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium", nameStatus[displayName.status].className)}>{nameStatus[displayName.status].label}</span>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {displayName.status === "pending" ? "Meta is reviewing your display name. Customers see your current name or number until Meta finishes."
            : displayName.status === "rejected" ? "Meta rejected this display name. Meta doesn't return the reason through the API; open WhatsApp Manager to see it and request a new name."
              : displayName.status === "unknown" ? "Meta didn't report a review status for this number. Check WhatsApp Manager for details."
                : "Display name changes are reviewed by Meta. To change it, request a new name in WhatsApp Manager."}
        </p>
      </Section>

      <Section title="Customer visibility" description="What customers may see when you message them.">
        <p className="text-sm leading-6">Meta approval does not always mean the display name appears immediately to every WhatsApp user. Some customers may temporarily see your phone number instead.</p>
        {displayName.status === "approved" && (
          <p className="rounded-lg bg-emerald-500/5 px-3 py-2 text-xs leading-5 text-emerald-900">Your display name is approved. WhatsApp may still show your phone number to some users while Meta propagates or applies the business identity across clients.</p>
        )}
        <p className="text-xs text-muted-foreground">Tany can&rsquo;t change how WhatsApp apps display your name.</p>
      </Section>

      <Section title="Profile completeness" description="Separate from display-name approval.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {profileChecklist(saved).map(item => (
            <li key={item.label} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                {item.complete ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
                {item.label}
              </span>
              <span className={cn("text-xs font-medium", item.complete ? "text-emerald-700" : "text-muted-foreground")}>{!snapshot ? "Not loaded" : item.complete ? "Complete" : "Missing"}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Connection details">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Connection</dt><dd className="mt-0.5 flex items-center gap-2 font-medium"><StatusDot tone={connectionStatus === "Connected" ? "success" : "neutral"} />{connectionStatus}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Phone quality</dt><dd className="mt-0.5 font-medium">{qualityLabel[displayName.quality]}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Profile completeness</dt><dd className="mt-0.5 font-medium tabular-nums">{snapshot ? `${profileChecklist(saved).filter(item => item.complete).length} of ${profileChecklist(saved).length}` : "Not loaded"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Last refreshed from Meta</dt><dd className="mt-0.5 font-medium tabular-nums">{diagnostics ? refreshedAt(diagnostics.refreshedAt) : "Not loaded"}</dd></div>
        </dl>
        <details className="group rounded-lg bg-muted/40 px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">Advanced details<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <dl className="mt-2 grid gap-2 text-xs">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Phone number ID</dt><dd className="font-mono">{diagnostics?.phoneNumberId || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">WhatsApp Business Account ID</dt><dd className="font-mono">{diagnostics?.wabaId || "—"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Display phone number</dt><dd className="font-mono">{displayName.phone || "—"}</dd></div>
          </dl>
        </details>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
          {issues.length > 0 && dirty && <p className="mr-auto line-clamp-1 text-xs text-primary">{issues[0].message}</p>}
          <Button onClick={save} disabled={readOnly || pending || !dirty || issues.length > 0}>
            {pending && pictureStep === "" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
