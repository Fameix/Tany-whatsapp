import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { LoadingPanel } from "@/app/admin/components/shared";
import { DashboardAccessRequired } from "@/app/admin/components/dashboard-access-required";
import { canViewBusiness } from "@/app/business/_components/business-access";
import { loadBusiness } from "@/app/business/_components/load-business";
import { TemplateEditor } from "@/app/business/_components/templates/template-editor";
import { localStagingWorkspace } from "@/lib/admin/product-test-data";
import { getPostgresBusinessAccount } from "@/lib/admin/postgres-directory";
import { emptyTemplate } from "@/lib/templates/model";
import { getBusinessTemplate } from "@/lib/templates/repository";
import { workspaceRoot } from "@/lib/admin/workspace-root";

type Props = { params: Promise<{ businessId: string; templateId: string }> };

async function Editor({ params }: Props) {
  await connection();
  const { businessId, templateId } = await params;
  if (!(await canViewBusiness(businessId))) return <DashboardAccessRequired />;
  await loadBusiness(businessId);
  const root = `${await workspaceRoot(businessId)}/templates`;
  const [stored, account] = await Promise.all([
    templateId === "new" ? Promise.resolve(null) : getBusinessTemplate(businessId, templateId),
    getPostgresBusinessAccount(businessId),
  ]);
  if (templateId !== "new" && !stored) notFound();
  const template = stored
    ? {
      id: stored.id, status: stored.status, metaTemplateId: stored.metaTemplateId, rejectionReason: stored.rejectionReason, storedCategory: stored.storedCategory,
      content: { name: stored.name, category: stored.category, language: stored.language, header: stored.header, body: stored.body, footer: stored.footer, buttons: stored.buttons, examples: stored.examples },
    }
    : { id: null, status: "draft" as const, metaTemplateId: null, rejectionReason: null, storedCategory: "utility", content: emptyTemplate() };
  return <TemplateEditor key={template.id ?? "new"} businessId={businessId} root={root} template={template}
    connected={account?.status === "Connected"} localStaging={await localStagingWorkspace()} />;
}

export default function Page(props: Props) {
  return <Suspense fallback={<LoadingPanel />}><Editor {...props} /></Suspense>;
}
