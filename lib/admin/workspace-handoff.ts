import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { databaseMode } from "@/lib/data/repository";
import { documentId, serverTimestamp } from "@/lib/messaging/services/shared";
import { OperationsAccessError } from "@/lib/admin/client-access";
import type { IntegrationScope } from "@/lib/integration/access";
const handoffRef = (token: string) => adminDb.collection("dashboard_handoffs").doc(createHash("sha256").update(token).digest("hex"));

export async function createDashboardHandoff(scope: IntegrationScope) {
  if (scope.kind === "business") {
    const businessId = documentId(scope.businessId);
    const mode = databaseMode();
    const available = mode === "postgres" || mode === "dual-write"
      ? (await (await import("@/lib/admin/postgres-directory")).getPostgresBusinessProfile(businessId))?.active === true
      : (await adminDb.collection("businesses").doc(businessId).get()).exists;
    if (!available)
      throw new OperationsAccessError("NOT_FOUND", "Business unavailable.", 404);
    scope = { kind: "business", businessId };
  }
  const token = randomBytes(32).toString("hex");
  await handoffRef(token).create({
    scopeKind: scope.kind,
    ...(scope.kind === "business" ? { businessId: scope.businessId } : {}),
    used: false,
    expiresAt: Timestamp.fromMillis(Date.now() + 60000),
    createdAt: serverTimestamp(),
  });
  return { path: `/api/dashboard/connect?token=${token}` };
}

/** Called only inside the authenticated business-scoped integration boundary. */
export function createWorkspaceHandoff(businessId: string) {
  return createDashboardHandoff({ kind: "business", businessId });
}

function handoffScope(data: FirebaseFirestore.DocumentData): IntegrationScope {
  if (data.scopeKind === "directory") return { kind: "directory" };
  return { kind: "business", businessId: documentId(data.businessId) };
}

export async function consumeDashboardHandoff(token: string): Promise<IntegrationScope> {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new OperationsAccessError("INVALID_HANDOFF", "Open the dashboard from Tany.", 400);
  const ref = handoffRef(token);
  const initial = (await ref.get()).data();
  if (!initial || initial.used || !(initial.expiresAt instanceof Timestamp) || initial.expiresAt.toMillis() <= Date.now())
    throw new OperationsAccessError("INVALID_HANDOFF", "This dashboard link is invalid or expired.", 400);
  const scope = handoffScope(initial);
  await adminDb.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || current.used || !(current.expiresAt instanceof Timestamp) || current.expiresAt.toMillis() <= Date.now())
      throw new OperationsAccessError("INVALID_HANDOFF", "This dashboard link was already used or expired.", 400);
    const currentScope = handoffScope(current);
    if (currentScope.kind !== scope.kind)
      throw new OperationsAccessError("INVALID_HANDOFF", "This dashboard link is invalid.", 400);
    if (
      scope.kind === "business" &&
      (currentScope.kind !== "business" || currentScope.businessId !== scope.businessId)
    )
      throw new OperationsAccessError("INVALID_HANDOFF", "This dashboard link is invalid.", 400);
    tx.update(ref, { used: true, usedAt: serverTimestamp() });
  });
  return scope;
}

export async function consumeWorkspaceHandoff(token: string) {
  const scope = await consumeDashboardHandoff(token);
  if (scope.kind !== "business")
    throw new OperationsAccessError("INVALID_HANDOFF", "Business workspace access is required.", 400);
  return scope.businessId;
}
