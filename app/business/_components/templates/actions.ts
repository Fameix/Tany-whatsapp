"use server";
import { revalidatePath } from "next/cache";
import { requireDashboardAccess, DashboardAuthorizationError } from "@/lib/admin/dashboard-session";
import { loadBusiness } from "@/app/business/_components/load-business";
import { findStarter } from "@/lib/templates/starters";
import { emptyTemplate, templateContentFrom, type TemplateContent } from "@/lib/templates/model";
import { createBusinessTemplate, deleteBusinessTemplate, getBusinessTemplate, listBusinessTemplates, TemplateNameTakenError, updateBusinessTemplate } from "@/lib/templates/repository";
import { refreshTemplateStatus, submitTemplateToMeta, TemplateSubmissionError } from "@/lib/templates/meta-templates";

export type TemplateActionResult = { ok: true; id: string; message?: string } | { ok: false; message: string };

const root = (businessId: string) => `/business/${encodeURIComponent(businessId)}/templates`;

async function authorized(businessId: string) {
  await requireDashboardAccess(businessId);
  return loadBusiness(businessId);
}

function failure(error: unknown): TemplateActionResult {
  if (error instanceof DashboardAuthorizationError) return { ok: false, message: "You don't have access to this business." };
  if (error instanceof TemplateNameTakenError) return { ok: false, message: "A template with this name and language already exists. Choose another name." };
  if (error instanceof TemplateSubmissionError) return { ok: false, message: error.message };
  console.error("[TEMPLATE_ACTION_FAILED]", { error: error instanceof Error ? error.name : typeof error });
  return { ok: false, message: "Something went wrong. Please try again." };
}

/** Only the editable fields, normalised; ids and lifecycle fields never come from the client. */
function cleanContent(input: unknown): TemplateContent {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const content = templateContentFrom(value);
  return { ...content, name: content.name.trim().toLowerCase(), examples: content.examples.slice(0, 20) };
}

/** Copies a read-only starter into a draft owned by this business. */
export async function copyStarterTemplate(businessId: string, starterKey: string): Promise<TemplateActionResult> {
  try {
    const business = await authorized(businessId);
    const starter = findStarter(business.vertical, starterKey);
    if (!starter) return { ok: false, message: "This starter template isn't available for your product." };
    const taken = new Set((await listBusinessTemplates(businessId)).map(template => `${template.name}:${template.language}`));
    let name = starter.name;
    for (let n = 2; taken.has(`${name}:en`); n++) name = `${starter.name}_${n}`;
    const id = await createBusinessTemplate(businessId, { ...emptyTemplate(), name, category: starter.category, body: starter.body, buttons: starter.buttons.map(button => ({ ...button })), examples: [...starter.examples] }, { starterKey: starter.key, product: business.vertical });
    revalidatePath(root(businessId));
    return { ok: true, id };
  } catch (error) { return failure(error); }
}

export async function saveTemplate(businessId: string, id: string | null, input: unknown): Promise<TemplateActionResult> {
  try {
    await authorized(businessId);
    const content = cleanContent(input);
    if (!/^[a-z0-9_]{1,120}$/.test(content.name)) return { ok: false, message: "Give the template a name using lowercase letters, numbers and underscores." };
    if (!id) {
      const created = await createBusinessTemplate(businessId, content);
      revalidatePath(root(businessId));
      return { ok: true, id: created, message: "Draft saved." };
    }
    const current = await getBusinessTemplate(businessId, id);
    if (!current) return { ok: false, message: "Template not found." };
    if (current.status !== "draft" && current.status !== "rejected") return { ok: false, message: "Templates in review or approved by Meta can't be edited." };
    // A submitted template keeps its name and language; Meta identifies it by them.
    if (current.metaTemplateId && (content.name !== current.name || content.language !== current.language))
      return { ok: false, message: "A template submitted to Meta keeps its name and language. Create a new template to change them." };
    await updateBusinessTemplate(businessId, id, { content, status: current.status });
    revalidatePath(root(businessId));
    return { ok: true, id, message: "Draft saved." };
  } catch (error) { return failure(error); }
}

export async function submitTemplate(businessId: string, id: string): Promise<TemplateActionResult> {
  try {
    await authorized(businessId);
    const template = await submitTemplateToMeta(businessId, id);
    revalidatePath(root(businessId));
    return { ok: true, id, message: template.status === "approved" ? "Approved by Meta." : "Submitted to Meta for review." };
  } catch (error) { return failure(error); }
}

export async function refreshTemplate(businessId: string, id: string): Promise<TemplateActionResult> {
  try {
    await authorized(businessId);
    const template = await refreshTemplateStatus(businessId, id);
    revalidatePath(root(businessId));
    return { ok: true, id, message: template.status === "pending" ? "Still in review with Meta." : `Status: ${template.status}.` };
  } catch (error) { return failure(error); }
}

export async function deleteTemplate(businessId: string, id: string): Promise<TemplateActionResult> {
  try {
    await authorized(businessId);
    const current = await getBusinessTemplate(businessId, id);
    if (!current || current.status !== "draft" || current.metaTemplateId) return { ok: false, message: "Only drafts that were never submitted can be deleted." };
    await deleteBusinessTemplate(businessId, id);
    revalidatePath(root(businessId));
    return { ok: true, id, message: "Draft deleted." };
  } catch (error) { return failure(error); }
}
