import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";

// The Firestore Admin SDK cannot be evaluated in the Workers runtime (gRPC,
// protobuf code generation, Google ADC). This Vite build targets Cloudflare
// only, so resolve it to a Worker-safe module; `next build` keeps the real SDK.
const firebaseAdminWorker = fileURLToPath(new URL("./lib/cloudflare/firebase-admin-worker.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^firebase-admin\/(app|firestore|auth)$/, replacement: firebaseAdminWorker }],
  },
  plugins: [
    vinext({
      cache: responseStoreAdapter({ mode: "self-contained" }),
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
