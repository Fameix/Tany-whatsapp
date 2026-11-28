import "server-only";
import { runtimeRepositoryFor } from "@/lib/data/repository";
import { accountAccessToken } from "@/lib/whatsapp/credentials";
import { metaComponents, statusFromMeta, validateTemplate, type TemplateCategory } from "./model";
import { createAuthenticationTemplate, getBusinessTemplate, updateBusinessTemplate, type BusinessTemplate } from "./repository";

export class TemplateSubmissionError extends Error {
  constructor(public code: "NOT_CONNECTED" | "INVALID" | "NOT_SUBMITTABLE" | "META_REJECTED_REQUEST" | "META_UNAVAILABLE" | "NOT_FOUND", message: string) {
    super(message);
  }
}

const graphVersion = () => process.env.META_GRAPH_VERSION || "v27.0";

/** This business's own WABA and its Secret Manager credential; never a global token. */
async function metaAccount(businessId: string) {
  const account = await (await runtimeRepositoryFor()).getWhatsAppAccount(businessId);
  const wabaId = typeof account?.wabaId === "string" && /^\d{1,40}$/.test(account.wabaId) ? account.wabaId : "";
  if (!account || account.status !== "connected" || !wabaId || !account.tokenSecretName)
    throw new TemplateSubmissionError("NOT_CONNECTED", "Connect WhatsApp before submitting templates to Meta.");
  const token = await accountAccessToken(account.tokenSecretName, businessId);
  if (!token) throw new TemplateSubmissionError("NOT_CONNECTED", "Tany couldn't access this business's WhatsApp credential. Reconnect WhatsApp and try again.");
  return { wabaId, token };
}

/** Meta's user-facing message only; never the request, token or full payload. */
async function graph<T>(path: string, token: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await response.json().catch(() => null) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number } } | null;
  if (!response.ok) {
    const meta = payload?.error;
    const message = (meta?.error_user_msg || meta?.message || "Meta could not process this template.").slice(0, 300);
    console.error("[TEMPLATE_META_FAILED]", { path: path.replace(/\d{6,}/g, "…"), status: response.status, code: meta?.code });
    throw new TemplateSubmissionError(response.status >= 500 ? "META_UNAVAILABLE" : "META_REJECTED_REQUEST", message);
  }
  return payload as T;
}

const metaCategory = (value: unknown): TemplateCategory | undefined => {
  const category = String(value ?? "").toLowerCase();
  return category === "utility" || category === "marketing" || category === "authentication" ? category : undefined;
};

/** Submits a draft (or resubmits a rejected template) for Meta review. */
export async function submitTemplateToMeta(businessId: string, id: string): Promise<BusinessTemplate> {
  const template = await getBusinessTemplate(businessId, id);
  if (!template) throw new TemplateSubmissionError("NOT_FOUND", "Template not found.");
  if (template.status !== "draft" && template.status !== "rejected")
    throw new TemplateSubmissionError("NOT_SUBMITTABLE", "Only drafts and rejected templates can be submitted.");
  const issues = validateTemplate(template);
  if (issues.length) throw new TemplateSubmissionError("INVALID", issues[0].message);
  const { wabaId, token } = await metaAccount(businessId);
  const components = metaComponents(template);
  const result = template.metaTemplateId
    // A template Meta already knows (rejected) is edited in place rather than recreated.
    ? await graph<{ success?: boolean }>(encodeURIComponent(template.metaTemplateId), token, { method: "POST", body: { category: template.category.toUpperCase(), components } })
      .then(() => ({ id: template.metaTemplateId!, status: "PENDING", category: template.category }))
    : await graph<{ id?: string; status?: string; category?: string }>(`${encodeURIComponent(wabaId)}/message_templates`, token, {
      method: "POST",
      body: { name: template.name, language: template.language, category: template.category.toUpperCase(), components },
    });
  if (!result.id) throw new TemplateSubmissionError("META_UNAVAILABLE", "Meta did not return a template id. Try again.");
  await updateBusinessTemplate(businessId, id, {
    status: statusFromMeta(result.status),
    metaTemplateId: String(result.id),
    rejectionReason: null,
    submittedAt: new Date().toISOString(),
    category: metaCategory(result.category),
  });
  return (await getBusinessTemplate(businessId, id))!;
}

/** Meta's standard Authentication template: fixed body with the security line, a code-expiry footer
 * and a Copy code button. Used for WhatsApp sign-in codes (lib/auth/whatsapp-otp). */
export function authenticationTemplateComponents(codeExpirationMinutes = 5) {
  return [
    { type: "BODY", add_security_recommendation: true },
    { type: "FOOTER", code_expiration_minutes: codeExpirationMinutes },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy code" }] },
  ];
}

/** Submits this business's sign-in code template to its own WABA and records it. */
export async function submitAuthenticationTemplate(businessId: string, name: string, language: string): Promise<BusinessTemplate> {
  if (!/^[a-z0-9_]{1,120}$/.test(name)) throw new TemplateSubmissionError("INVALID", "Use lowercase letters, numbers and underscores.");
  const { wabaId, token } = await metaAccount(businessId);
  const result = await graph<{ id?: string; status?: string }>(`${encodeURIComponent(wabaId)}/message_templates`, token, {
    method: "POST",
    body: { name, language, category: "AUTHENTICATION", components: authenticationTemplateComponents() },
  });
  if (!result.id) throw new TemplateSubmissionError("META_UNAVAILABLE", "Meta did not return a template id. Try again.");
  const id = await createAuthenticationTemplate(businessId, { name, language, metaTemplateId: String(result.id), status: statusFromMeta(result.status) });
  return (await getBusinessTemplate(businessId, id))!;
}

/** Why Meta may refuse templates for this business: its WABA's review, verification and health,
 * read with the business's own token. Identifiers are not returned. */
export async function wabaTemplateReadiness(businessId: string) {
  const { wabaId, token } = await metaAccount(businessId);
  const waba = await graph<{ account_review_status?: string; business_verification_status?: string; ownership_type?: string; health_status?: { can_send_message?: string; entities?: { entity_type?: string; can_send_message?: string; errors?: { error_code?: number; error_description?: string; possible_solution?: string }[] }[] } }>(
    `${encodeURIComponent(wabaId)}?fields=account_review_status,business_verification_status,ownership_type,health_status`, token, { method: "GET" });
  return {
    accountReviewStatus: waba.account_review_status ?? null,
    businessVerificationStatus: waba.business_verification_status ?? null,
    ownershipType: waba.ownership_type ?? null,
    canSendMessage: waba.health_status?.can_send_message ?? null,
    issues: (waba.health_status?.entities ?? []).flatMap(entity => (entity.errors ?? []).map(error => ({ entity: entity.entity_type ?? null, code: error.error_code ?? null, description: error.error_description ?? null, solution: error.possible_solution ?? null }))),
  };
}

/** Reads the review result from Meta. Status changes only ever come from Meta. */
export async function refreshTemplateStatus(businessId: string, id: string): Promise<BusinessTemplate> {
  const template = await getBusinessTemplate(businessId, id);
  if (!template) throw new TemplateSubmissionError("NOT_FOUND", "Template not found.");
  if (!template.metaTemplateId) return template;
  const { token } = await metaAccount(businessId);
  const result = await graph<{ status?: string; rejected_reason?: string; category?: string }>(`${encodeURIComponent(template.metaTemplateId)}?fields=status,rejected_reason,category`, token, { method: "GET" });
  const status = statusFromMeta(result.status);
  const reason = typeof result.rejected_reason === "string" && result.rejected_reason !== "NONE" ? result.rejected_reason : null;
  const paused = String(result.status ?? "").toUpperCase();
  await updateBusinessTemplate(businessId, id, {
    status,
    category: metaCategory(result.category),
    rejectionReason: status === "rejected" ? reason ?? (paused === "PAUSED" ? "Paused by Meta because of quality feedback." : paused === "DISABLED" ? "Disabled by Meta." : "Rejected by Meta.") : null,
  });
  return (await getBusinessTemplate(businessId, id))!;
}

/** Best-effort refresh of templates waiting for review, so the library shows Meta's latest result. */
export async function refreshPendingTemplates(businessId: string, templates: BusinessTemplate[]) {
  const pending = templates.filter(template => template.status === "pending" && template.metaTemplateId).slice(0, 10);
  if (!pending.length) return false;
  const results = await Promise.allSettled(pending.map(template => refreshTemplateStatus(businessId, template.id)));
  return results.some(result => result.status === "fulfilled");
}
