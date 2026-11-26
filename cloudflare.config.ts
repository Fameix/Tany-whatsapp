import { bindings, defineConfig, defineWorker, exports as workerExports } from "cf/config";
import { createWorkersResponseStoreSelfContainedConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersResponseStoreSelfContainedConfig({
  worker: "tany-whatsapp",
  bucket: "tany-whatsapp-response-store-cache-bodies",
});

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "tany-whatsapp",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-10-27",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      // Phase 1 binding. Reads remain Firestore unless MESSAGING_DATABASE=d1.
      D1: bindings.d1({ name: "tany-messaging" }),
      MESSAGE_CLAIMS: bindings.durableObject({ worker: "tany-whatsapp", exportName: "MessageClaimCoordinator" }),
    },
    exports: {
      ...cache.exports,
      MessageClaimCoordinator: workerExports.durableObject({ storage: "sqlite" }),
    },
  }),
});
