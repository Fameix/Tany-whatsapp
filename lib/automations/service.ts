import { isTanyVertical } from "@/lib/messaging/vertical-config";
import { assertVerticalAutomationAllowed, recipesForEnabledProducts, type ActiveAutomationVertical } from "@/lib/automations/vertical-registry";
import { isSendableWithBodyParameters, templateContentFrom } from "@/lib/templates/model";
import "server-only";
import { randomUUID } from "node:crypto";
import { automationPersistence } from "@/lib/automations/persistence";
import { getEnabledProducts, requireWhatsAppEntitlement } from "@/lib/subscriptions/entitlements";
import { getBusinessConfig } from "@/lib/messaging/services/business-config-service";
import { documentId } from "@/lib/messaging/services/shared";
import {
  validateAutomation,
  type Automation,
  type Run,
} from "@/lib/automations/model";
export async function requireAutomationBusiness(id: string) {
  const business = await getBusinessConfig(documentId(id));
  if (!business) throw new Error("Business not found.");
  await requireWhatsAppEntitlement(id);
  return business;
}
export class ProductAccessError extends Error {
  readonly status = 403;
  constructor() { super("This automation product is not enabled for this business."); }
}
async function automationProduct(businessId: string, business: { vertical: unknown }): Promise<ActiveAutomationVertical> {
  const enabled = await getEnabledProducts(businessId);
  if (!isTanyVertical(business.vertical) || !enabled.includes(business.vertical as ActiveAutomationVertical)) throw new ProductAccessError();
  return business.vertical as ActiveAutomationVertical;
}
const iso = (v: unknown) =>
  v instanceof Date
    ? v.toISOString()
    : v && typeof v === "object" && "toDate" in v
    ? (v as { toDate(): Date }).toDate().toISOString()
    : typeof v === "string"
      ? v
      : null;

async function dashboardStage<T>(
  businessId: string,
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV === "development")
    console.info("[AUTOMATION_STAGE_START]", { businessId, stage });
  try {
    const result = await operation();
    if (process.env.NODE_ENV === "development")
      console.info("[AUTOMATION_STAGE_DONE]", {
        businessId,
        stage,
        count: Array.isArray(result) ? result.length : undefined,
      });
    return result;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const details = error as Error & { code?: unknown };
      console.error("[AUTOMATION_STAGE_FAILED]", {
        businessId,
        stage,
        name: details.name,
        code: details.code,
        message: details.message,
        stack: details.stack,
      });
    }
    throw error;
  }
}

export async function automationDashboard(businessId: string) {
  const business = await dashboardStage(businessId, "business", () =>
    requireAutomationBusiness(businessId),
  );
  const product = await automationProduct(businessId, business);
  const enabledProducts = await getEnabledProducts(businessId);
  if (process.env.NODE_ENV === "development")
    console.info("[AUTOMATION_UNUSED_DEPENDENCIES]", {
      businessId,
      whatsappAccount: false,
      subscription: false,
      entitlement: false,
    });
  const repository = automationPersistence();
  const [automations, runs, templates] = await Promise.all([
    dashboardStage(businessId, "automations", () => repository.list("automations", businessId)),
    dashboardStage(businessId, "automation_runs", () => repository.list("automation_runs", businessId)),
    dashboardStage(businessId, "templates", () => repository.list("templates", businessId)),
  ]);
  return {
    vertical: product,
    // Recipes set up a workflow only; message content always comes from the business's
    // approved templates below.
    recipes: recipesForEnabledProducts(enabledProducts),
    automations: automations.map((d) => {
      const v = d;
      return {
        ...validateAutomation(v),
        id: d.id,
        businessId,
        status: v.status,
        createdAt: iso(v.createdAt),
        updatedAt: iso(v.updatedAt),
        publishedAt: iso(v.publishedAt),
      } as Automation;
    }),
    runs: runs
      .map((d) => {
        const v = d;
        return {
          id: d.id,
          automationId: v.automationId,
          businessId,
          trigger: v.trigger,
          status: v.status,
          startedAt: iso(v.startedAt),
          completedAt: iso(v.completedAt),
          actionsExecuted: v.actionsExecuted ?? 0,
          error: v.error ?? null,
        } as Run;
      })
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    // Templates this business has that automations can't use yet, so the UI can explain why.
    unavailableTemplates: templates
      .filter((d) => d.businessId === businessId && ["draft", "pending", "rejected"].includes(String(d.status)))
      .map((d) => ({ name: String(d.name ?? "Template"), status: d.status as "draft" | "pending" | "rejected" })),
    // This business's Templates library only: approved by Meta and sendable by the engine.
    templates: templates
      .filter((d) => d.businessId === businessId && d.status === "approved" && isSendableWithBodyParameters(d.components))
      .map((d) => {
        const content = templateContentFrom(d);
        return {
          id: d.id,
          name: String(d.name ?? "Template"),
          body: String(d.body ?? ""),
          category: String(d.category ?? ""),
          language: String(d.language ?? ""),
          header: content.header,
          footer: content.footer,
          buttons: content.buttons,
          examples: content.examples,
        };
      }),
  };
}
export async function saveAutomation(
  businessId: string,
  id: string | undefined,
  input: unknown,
  enforceVertical = true,
  productOverride?: ActiveAutomationVertical,
) {
  const business = await requireAutomationBusiness(businessId);
  const defaultProduct = await automationProduct(businessId, business);
  const enabledProducts = await getEnabledProducts(businessId);
  const validated = validateAutomation(input);
  const product = productOverride ?? validated.product ?? defaultProduct;
  if (!enabledProducts.includes(product)) throw new ProductAccessError();
  const data = enforceVertical ? assertVerticalAutomationAllowed(product, validated) : validated;
  const repository = automationPersistence();
  const automationId = id ? documentId(id) : randomUUID();
  const current = id ? await repository.get("automations", businessId, automationId) : null;
  if (id && !current) throw new Error("Automation not found.");
  const now = new Date().toISOString();
  await repository.upsert("automations", {
    ...data, id: automationId, businessId, product: current?.product ?? product,
    status: "draft", createdAt: current?.createdAt ?? now, updatedAt: now,
    publishedAt: current?.publishedAt ?? null,
  });
  return automationId;
}
export async function changeAutomation(
  businessId: string,
  id: string,
  operation: "publish" | "pause" | "resume" | "delete" | "duplicate",
) {
  const business = await requireAutomationBusiness(businessId);
  const enabledProducts = await getEnabledProducts(businessId);
  const repository = automationPersistence();
  const automationId = documentId(id);
  const current = await repository.get("automations", businessId, automationId);
  if (!current) throw new Error("Automation not found.");
    const product = current.product ?? business.vertical;
    if (!isTanyVertical(product) || !enabledProducts.includes(product as ActiveAutomationVertical)) throw new ProductAccessError();
    const data = validateAutomation(current);
    if (["publish", "resume"].includes(operation)) {
      if (
        data.trigger.type === "schedule.triggered" &&
        Date.parse(data.trigger.at!) <= Date.now()
      )
        throw new Error("Choose a future schedule before publishing.");
      for (const action of data.actions.filter((a) => a.type === "template")) {
        const template = await repository.get("templates", businessId, documentId(action.templateId!));
        if (
          !template ||
          template.businessId !== businessId ||
          template.status !== "approved" ||
          (typeof template.vertical === "string" && !enabledProducts.includes(template.vertical as ActiveAutomationVertical))
        )
          throw new ProductAccessError();
      }
    }
    const now = new Date().toISOString();
    if (operation === "delete") await repository.delete("automations", businessId, automationId);
    else if (operation === "duplicate") {
      const copyId = randomUUID();
      await repository.create("automations", {
        ...data,
        id: copyId,
        name: `${data.name.slice(0, 110)} (copy)`,
        businessId,
        product,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      });
      return copyId;
    } else
      await repository.update("automations", businessId, automationId, {
        status: operation === "pause" ? "paused" : "active",
        updatedAt: now,
        ...(operation !== "pause" ? { publishedAt: now } : {}),
      });
    return automationId;
}
