"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, ExternalLink, LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/app/business/_components/home/home-primitives";
import { pictureLimits, profileLimits, profileVerticals, validateProfile, type BusinessProfile, type DisplayName, type EditableProfile } from "@/lib/whatsapp/business-profile-model";
import { saveBusinessProfile, uploadProfilePicture } from "./actions";

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
  approved: { label: "Approved", className: "bg-emerald-500/10 text-emerald-800" },
  pending: { label: "Pending review", className: "bg-amber-500/10 text-amber-800" },
  rejected: { label: "Rejected", className: "bg-primary/10 text-primary" },
  unknown: { label: "Unknown", className: "bg-muted text-muted-foreground" },
} as const;

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

export function ProfileEditor({ businessId, initial, displayName, managerUrl }: { businessId: string; initial: BusinessProfile; displayName: DisplayName; managerUrl: string }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<EditableProfile>(() => ({ about: initial.about, description: initial.description, email: initial.email, address: initial.address, websites: initial.websites, vertical: initial.vertical }));
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

  const accept = (profile: BusinessProfile, text: string) => {
    setSaved(profile);
    setDraft({ about: profile.about, description: profile.description, email: profile.email, address: profile.address, websites: profile.websites, vertical: profile.vertical });
    setMessage({ tone: "ok", text });
  };
  const save = () => startTransition(async () => {
    const result = await saveBusinessProfile(businessId, draft);
    if (result.ok) accept(result.profile, result.message); else setMessage({ tone: "error", text: result.message });
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
    const result = await uploadProfilePicture(businessId, form);
    setPictureStep("");
    if (result.ok) { URL.revokeObjectURL(picture.url); setPicture(null); accept(result.profile, result.message); }
    else setMessage({ tone: "error", text: result.message });
  });

  const avatar = picture?.url ?? saved.profilePictureUrl;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-24">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Business Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage how your business appears to customers on WhatsApp.</p>
      </div>

      <div className={cn(surface, "flex items-center gap-4 p-4 sm:p-6")}>
        <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-lg font-semibold text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element -- Meta-hosted profile image */}
          {avatar ? <img src={avatar} alt="WhatsApp profile picture" className="size-full object-cover" /> : (displayName.name || "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{displayName.name || "Display name not set"}</p>
          <p className="truncate text-sm text-muted-foreground tabular-nums">{displayName.phone}</p>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><StatusDot tone="success" />Connected</p>
        </div>
      </div>

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm", message.tone === "error" ? "bg-primary/8 text-primary" : "bg-emerald-500/10 text-emerald-800")}>{message.text}</p>}

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

      <Section title="Display name" description="The name customers see on WhatsApp.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName.name || "Not set"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Display name changes are reviewed by Meta.</p>
          </div>
          <span className={cn("inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium", nameStatus[displayName.status].className)}>{nameStatus[displayName.status].label}</span>
        </div>
        <a href={managerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-xs font-medium text-primary hover:underline">
          Request a name change in WhatsApp Manager<ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3">
          {issues.length > 0 && dirty && <p className="mr-auto line-clamp-1 text-xs text-primary">{issues[0].message}</p>}
          <Button onClick={save} disabled={pending || !dirty || issues.length > 0}>
            {pending && pictureStep === "" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}
