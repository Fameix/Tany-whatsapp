import type { D1Like } from "@/lib/data/types";

export type MessageClaimStub = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
export type MessagingWorkerBindings = {
  D1?: D1Like;
  MESSAGE_CLAIMS?: { idFromName(name: string): unknown; get(id: unknown): MessageClaimStub };
  IMAGES?: unknown;
  R2?: unknown;
  [key: string]: unknown;
};

const requestBindings = new WeakMap<Request, MessagingWorkerBindings>();

/** Scoped to an individual Worker request; no binding is retained after it settles. */
export async function withWorkerBindings<T>(request: Request, bindings: MessagingWorkerBindings, operation: () => Promise<T>): Promise<T> {
  requestBindings.set(request, bindings);
  try { return await operation(); }
  finally { requestBindings.delete(request); }
}

export function workerBindingsFor(request: Request): MessagingWorkerBindings {
  const bindings = requestBindings.get(request);
  if (!bindings) throw new Error("Cloudflare bindings are unavailable outside an active Worker request.");
  return bindings;
}

export function d1For(request: Request): D1Like {
  const d1 = workerBindingsFor(request).D1;
  if (!d1) throw new Error("D1 binding is required for this operation.");
  return d1;
}

export function messageClaimsFor(request: Request): NonNullable<MessagingWorkerBindings["MESSAGE_CLAIMS"]> {
  const claims = workerBindingsFor(request).MESSAGE_CLAIMS;
  if (!claims) throw new Error("MESSAGE_CLAIMS Durable Object binding is required for this operation.");
  return claims;
}
