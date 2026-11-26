import vinextHandler from "vinext/server/fetch-handler";
import { withWorkerBindings, type MessagingWorkerBindings } from "./bindings";

export { MessageClaimCoordinator } from "./message-claim-coordinator";

type FetchHandler = { fetch(request: Request, env: MessagingWorkerBindings, context: unknown): Response | Promise<Response> };
const handler = vinextHandler as FetchHandler;

/** Preserves Vinext routing while making Worker bindings request-scoped. */
const worker = {
  fetch(request: Request, env: MessagingWorkerBindings, context: unknown) {
    return withWorkerBindings(request, env, async () => handler.fetch(request, env, context));
  },
};

export default worker;
