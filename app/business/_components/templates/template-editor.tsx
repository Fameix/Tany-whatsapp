"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { limits, nextVariable, templateLanguages, templateVariables, validateTemplate, type TemplateButton, type TemplateContent, type TemplateStatus } from "@/lib/templates/model";
import { deleteTemplate, refreshTemplate, saveTemplate, submitTemplate } from "./actions";
import { CategoryBadge, TemplatePreview, TemplateStatusBadge } from "./template-preview";

export type EditorTemplate = { id: string | null; status: TemplateStatus; content: TemplateContent; metaTemplateId: string | null; rejectionReason: string | null; storedCategory: string };

const fieldClass = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60";

function Section({ title, description, children, optional }: { title: string; description?: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}{optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Optional</span>}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cn("text-[11px] tabular-nums", value > max ? "text-primary" : "text-muted-foreground")}>{value}/{max}</span>;
}

export function TemplateEditor({ businessId, root, template, connected, localStaging = false }: { businessId: string; root: string; template: EditorTemplate; connected: boolean; localStaging?: boolean }) {
  const router = useRouter();
  const [content, setContent] = useState(template.content);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"save" | "submit" | "refresh" | "delete" | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editable = template.status === "draft" || template.status === "rejected";
  const lockedIdentity = !!template.metaTemplateId;
  const variables = templateVariables(content.body);
  const issues = validateTemplate(content);
  const dirty = JSON.stringify(content) !== JSON.stringify(template.content);

  const update = (patch: Partial<TemplateContent>) => setContent(current => {
    const next = { ...current, ...patch };
    const count = templateVariables(next.body).length;
    return { ...next, examples: Array.from({ length: count }, (_, i) => next.examples[i] ?? "") };
  });
  const setButton = (index: number, button: TemplateButton) => update({ buttons: content.buttons.map((b, i) => (i === index ? button : b)) });
  const addVariable = () => {
    const token = `{{${nextVariable(content.body)}}}`;
    const element = bodyRef.current;
    const at = element?.selectionStart ?? content.body.length;
    update({ body: `${content.body.slice(0, at)}${token}${content.body.slice(element?.selectionEnd ?? at)}` });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(at + token.length, at + token.length); });
  };

  const run = (kind: "save" | "submit" | "refresh" | "delete") => startTransition(async () => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === "delete") {
        const result = await deleteTemplate(businessId, template.id!);
        if (result.ok) { router.push(root); return; }
        setMessage({ tone: "error", text: result.message });
        return;
      }
      if (kind === "refresh") {
        const result = await refreshTemplate(businessId, template.id!);
        setMessage(result.ok ? { tone: "ok", text: result.message ?? "Updated." } : { tone: "error", text: result.message });
        router.refresh();
        return;
      }
      // Submitting always saves the latest edits first.
      const saved = editable && (dirty || !template.id) ? await saveTemplate(businessId, template.id, content) : { ok: true as const, id: template.id! };
      if (!saved.ok) { setMessage({ tone: "error", text: saved.message }); return; }
      if (kind === "save") {
        setMessage({ tone: "ok", text: saved.message ?? "Draft saved." });
        if (!template.id) router.replace(`${root}/${encodeURIComponent(saved.id)}`);
        else router.refresh();
        return;
      }
      const submitted = await submitTemplate(businessId, saved.id);
      setMessage(submitted.ok ? { tone: "ok", text: submitted.message ?? "Submitted." } : { tone: "error", text: submitted.message });
      if (!template.id) router.replace(`${root}/${encodeURIComponent(saved.id)}`);
      else router.refresh();
    } finally { setBusy(null); }
  });

  const canSubmit = editable && connected && !issues.length && !pending;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href={root} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />Templates</Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{template.id ? content.name || "Untitled template" : "New template"}</h1>
            <TemplateStatusBadge status={template.status} />
            {template.storedCategory === "authentication" && <CategoryBadge category="authentication" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {template.status === "pending" ? "Meta is reviewing this template. It can be used once approved."
              : template.status === "approved" ? "Approved by Meta. Use it in Inbox, Automations and Campaigns."
                : "Write your message, then submit it to Meta for approval."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {template.id && template.status === "draft" && !template.metaTemplateId && (
            <Button variant="ghost" size="sm" onClick={() => run("delete")} disabled={pending} className="text-muted-foreground"><Trash2 className="size-4" aria-hidden="true" />Delete</Button>
          )}
          {template.status === "pending" && (
            <Button variant="outline" size="sm" onClick={() => run("refresh")} disabled={pending || localStaging}>{busy === "refresh" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}Check status</Button>
          )}
          {editable && (
            <>
              <Button variant="outline" size="sm" onClick={() => run("save")} disabled={pending || (!!template.id && !dirty)}>{busy === "save" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}Save draft</Button>
              <Button size="sm" onClick={() => run("submit")} disabled={!canSubmit || localStaging}>{busy === "submit" && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}Submit for approval</Button>
            </>
          )}
        </div>
      </div>

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={cn("rounded-lg px-4 py-3 text-sm", message.tone === "error" ? "bg-primary/8 text-primary" : "bg-emerald-500/10 text-emerald-800")}>{message.text}</p>}
      {template.status === "rejected" && template.rejectionReason && (
        <div className="flex gap-2 rounded-lg bg-primary/8 px-4 py-3 text-sm text-primary"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p><span className="font-medium">Meta rejected this template:</span> {template.rejectionReason}. Edit it and submit again.</p></div>
      )}
      {localStaging && (editable || template.status === "pending") && <p className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">Open the staging workspace to submit templates or check their approval status. Drafts can be saved here.</p>}
      {!localStaging && editable && !connected && <p className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">Connect WhatsApp to submit templates to Meta. You can still save drafts.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-6 rounded-xl bg-card p-4 shadow-[0_1px_2px_rgb(9_9_11/0.05),0_0_0_1px_rgb(9_9_11/0.06)] sm:p-6">
          <legend className="sr-only">Template content</legend>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Template name
              <Input value={content.name} disabled={!editable || lockedIdentity} maxLength={limits.name} placeholder="order_confirmed" className="font-mono" onChange={e => update({ name: e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "") })} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Category
              <select className={fieldClass} value={content.category} onChange={e => update({ category: e.target.value === "marketing" ? "marketing" : "utility" })}>
                <option value="utility">Utility</option>
                <option value="marketing">Marketing</option>
                <option value="authentication" disabled>Authentication (coming soon)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Language
              <select className={fieldClass} value={content.language} disabled={!editable || lockedIdentity} onChange={e => update({ language: e.target.value })}>
                {templateLanguages.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
              </select>
            </label>
          </div>
          <p className="-mt-4 text-[11px] text-muted-foreground">{content.category === "utility" ? "Utility: updates a customer expects, like order, payment or appointment confirmations." : "Marketing: offers, announcements and follow-ups. Customers can opt out."}</p>

          <Section title="Header" optional>
            <div className="flex items-center gap-2">
              <Input value={content.header} maxLength={limits.header + 10} placeholder="e.g. Order update" onChange={e => update({ header: e.target.value })} />
              <Counter value={content.header.length} max={limits.header} />
            </div>
          </Section>

          <Section title="Body" description="Use {{1}}, {{2}} … for details that change per customer.">
            <textarea ref={bodyRef} value={content.body} rows={6} maxLength={limits.body + 100} onChange={e => update({ body: e.target.value })}
              className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60" placeholder="Hi {{1}}, your order {{2}} has been confirmed." />
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" onClick={addVariable} className="-ml-2 h-7 text-xs"><Plus className="size-3.5" aria-hidden="true" />Add variable</Button>
              <Counter value={content.body.length} max={limits.body} />
            </div>
          </Section>

          <Section title="Variable examples" description="Meta reviews your template with these sample values. They are not sent to customers.">
            {variables.length ? (
              <div className="flex flex-col gap-2">
                {variables.map((n, index) => (
                  <label key={n} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{`{{${n}}}`}</span>
                    <Input value={content.examples[index] ?? ""} maxLength={limits.example} placeholder={`Example for {{${n}}}`} aria-label={`Example for variable ${n}`} onChange={e => update({ examples: content.examples.map((value, i) => (i === index ? e.target.value : value)) })} />
                  </label>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">No variables in this message.</p>}
          </Section>

          <Section title="Footer" optional>
            <div className="flex items-center gap-2">
              <Input value={content.footer} maxLength={limits.footer + 10} placeholder="e.g. Reply STOP to opt out" onChange={e => update({ footer: e.target.value })} />
              <Counter value={content.footer.length} max={limits.footer} />
            </div>
          </Section>

          <Section title="Buttons" optional description="Quick replies, a website link or a call button.">
            <div className="flex flex-col gap-2">
              {content.buttons.map((button, index) => (
                <div key={index} className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[9rem_minmax(0,10rem)_minmax(0,1fr)_2rem] sm:items-center">
                  <select aria-label="Button type" className={fieldClass} value={button.type} onChange={e => setButton(index, e.target.value === "URL" ? { type: "URL", text: button.text, url: "" } : e.target.value === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: button.text, phoneNumber: "" } : { type: "QUICK_REPLY", text: button.text })}>
                    <option value="QUICK_REPLY">Quick reply</option>
                    <option value="URL">Visit website</option>
                    <option value="PHONE_NUMBER">Call phone</option>
                  </select>
                  <Input aria-label="Button label" value={button.text} maxLength={limits.buttonText} placeholder="Label" onChange={e => setButton(index, { ...button, text: e.target.value })} />
                  {button.type === "URL" ? <Input aria-label="Website link" value={button.url} placeholder="https://" onChange={e => setButton(index, { ...button, url: e.target.value.trim() })} />
                    : button.type === "PHONE_NUMBER" ? <Input aria-label="Phone number" value={button.phoneNumber} placeholder="+919876543210" onChange={e => setButton(index, { ...button, phoneNumber: e.target.value.trim() })} />
                      : <span className="hidden text-xs text-muted-foreground sm:block">Customer taps to reply</span>}
                  <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${button.text || "button"}`} onClick={() => update({ buttons: content.buttons.filter((_, i) => i !== index) })}><X className="size-4" aria-hidden="true" /></Button>
                </div>
              ))}
              {content.buttons.length < limits.buttons && (
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => update({ buttons: [...content.buttons, { type: "QUICK_REPLY", text: "" }] })}><Plus className="size-3.5" aria-hidden="true" />Add button</Button>
              )}
            </div>
          </Section>

          {editable && issues.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-medium text-amber-900">Before submitting to Meta</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900/90">{issues.map(issue => <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>)}</ul>
            </div>
          )}
        </fieldset>

        <aside className="flex flex-col gap-2 lg:sticky lg:top-6 lg:self-start">
          <p className="text-xs font-medium text-muted-foreground">Preview</p>
          <TemplatePreview header={content.header} body={content.body} footer={content.footer} buttons={content.buttons} examples={content.examples} className="min-h-40" />
          <p className="text-[11px] leading-4 text-muted-foreground">Highlighted text shows your example values. Customers see the real details you send.</p>
        </aside>
      </div>
    </div>
  );
}
