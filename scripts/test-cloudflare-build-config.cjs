/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

async function main() {
  // One Cloudflare deployment config. A cloudflare.config.ts makes vinext-cloudflare
  // deploy use `cf deploy --prebuilt`, which needs .cloudflare/output, while
  // @cloudflare/vite-plugin builds Wrangler output into dist/ from wrangler.jsonc.
  assert.equal(fs.existsSync("cloudflare.config.ts"), false, "cloudflare.config.ts must not coexist with wrangler.jsonc");
  assert.ok(fs.existsSync("wrangler.jsonc"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["build:vinext"], "vite build");
  assert.equal(pkg.scripts["deploy:vinext"], "vinext-cloudflare deploy", "no --warm-cache / --prerender-all in CI deploy");

  // The Worker bundle must never contain the Firestore Admin SDK (gRPC, protobuf
  // codegen and ADC are unavailable in workerd).
  const vite = fs.readFileSync("vite.config.ts", "utf8");
  assert.match(vite, /find: \/\^firebase-admin\\\/\(app\|firestore\|auth\)\$\/, replacement: firebaseAdminWorker/);
  assert.match(vite, /lib\/cloudflare\/firebase-admin-worker\.ts/);
  assert.doesNotMatch(vite, /prerender/, "no build-time prerender in the Cloudflare build");

  const worker = await import("../lib/cloudflare/firebase-admin-worker.ts");
  const { Timestamp, FieldValue, FirebaseAdminUnavailableError } = worker;
  const at = Timestamp.fromMillis(1_795_610_731_929);
  assert.equal(at.toMillis(), 1_795_610_731_929);
  assert.equal(at.toDate().getTime(), 1_795_610_731_929);
  assert.equal(at.seconds, 1_795_610_731);
  assert.ok(at instanceof Timestamp);
  assert.ok(Timestamp.fromDate(new Date(0)).isEqual(new Timestamp(0, 0)));
  assert.ok(Math.abs(Timestamp.now().toMillis() - Date.now()) < 1000);
  assert.ok(Timestamp.fromMillis(2000) > Timestamp.fromMillis(1000), "Timestamps compare like Firestore's");
  assert.ok(FieldValue.serverTimestamp() instanceof FieldValue);
  assert.deepEqual(worker.getApps(), []);
  for (const [name, call] of [["initializeApp", () => worker.initializeApp({})], ["applicationDefault", () => worker.applicationDefault()], ["getFirestore", () => worker.getFirestore()], ["getAuth", () => worker.getAuth()]])
    assert.throws(call, FirebaseAdminUnavailableError, `${name} must fail loudly instead of falling back`);

  // Node builds keep the real SDK with lazy ADC.
  const firebaseAdmin = fs.readFileSync("lib/firebase-admin.ts", "utf8");
  assert.match(firebaseAdmin, /from "firebase-admin\/firestore"/);
  assert.match(firebaseAdmin, /export const adminDb = lazyService\(getAdminDb\);/);
  console.log("PASS Cloudflare build config: single Wrangler config, Firestore SDK aliased out of the Worker, Worker-safe Timestamp, Firestore/Auth fail loudly");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
