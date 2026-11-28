import { NextRequest, NextResponse } from "next/server";
import { DashboardAuthorizationError } from "@/lib/admin/dashboard-session";
import { requireProductWhatsAppBusiness } from "@/lib/admin/product-whatsapp-access";
import { adminProductPath } from "@/lib/admin/product-routes";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { completeEmbeddedSignup } from "@/lib/whatsapp/embedded-signup-service";
import { disconnectWhatsAppSetup, SetupError } from "@/lib/whatsapp/setup-service";
import { refreshTemplateStatus, submitAuthenticationTemplate, TemplateSubmissionError, wabaTemplateReadiness } from "@/lib/templates/meta-templates";
import { listBusinessTemplates, TemplateNameTakenError } from "@/lib/templates/repository";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (data: object, status = 200) => NextResponse.json(data, { status, headers });

export async function POST(request: NextRequest, { params }: { params: Promise<{ product: string; businessId: string }> }) {
  const origin = request.headers.get("origin");
  if (origin !== request.nextUrl.origin || request.nextUrl.protocol !== "https:") return json({ message: "Invalid request origin." }, 403);
  const { product, businessId } = await params;
  if (!isActiveTanyVertical(product)) return json({ message: "Product unavailable." }, 404);
  try {
    await requireProductWhatsAppBusiness(product, businessId, true);
    const action = request.nextUrl.searchParams.get("action");
    if (action === "signup") {
      await completeEmbeddedSignup(businessId, await request.json());
      return json({ ok: true, dashboardUrl: `${adminProductPath(product)}/whatsapp?business=${encodeURIComponent(businessId)}` });
    }
    if (action === "disconnect") {
      await disconnectWhatsAppSetup(businessId);
      return json({ ok: true });
    }
    if (action === "template-readiness") return json({ ok: true, readiness: await wabaTemplateReadiness(businessId) });
    // WhatsApp sign-in codes need one approved Authentication template on the business's own WABA.
    if (action === "authentication-template" || action === "authentication-template-status") {
      const { name = "tany_login_code", language = "en" } = await request.json().catch(() => ({})) as { name?: string; language?: string };
      if (typeof name !== "string" || typeof language !== "string" || !/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) return json({ message: "Choose a valid template name and language." }, 400);
      const existing = (await listBusinessTemplates(businessId)).find(template => template.name === name && template.language === language);
      const template = action === "authentication-template-status"
        ? existing ? await refreshTemplateStatus(businessId, existing.id) : null
        : existing ?? await submitAuthenticationTemplate(businessId, name, language);
      if (!template) return json({ message: "That template has not been submitted." }, 404);
      return json({ ok: true, template: { name: template.name, language: template.language, category: template.storedCategory, status: template.status, rejectionReason: template.rejectionReason } });
    }
    return json({ message: "Choose a valid connection action." }, 400);
  } catch (error) {
    if (error instanceof DashboardAuthorizationError || error instanceof SetupError) return json({ message: error.message }, error.status);
    if (error instanceof TemplateSubmissionError) return json({ code: error.code, message: error.message }, error.code === "META_UNAVAILABLE" ? 503 : error.code === "NOT_FOUND" ? 404 : 400);
    if (error instanceof TemplateNameTakenError) return json({ message: error.message }, 409);
    return json({ message: "Could not update WhatsApp. Please try again." }, error instanceof SyntaxError ? 400 : 503);
  }
}
