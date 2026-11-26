/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("scripts/start-dev.cjs", "utf8");
assert.match(source, /Get-NetTCPConnection -LocalPort 3000/);
assert.match(source, /TANY_MESSAGING_ROOT/);
assert.match(source, /isProjectNextDev/);
assert.match(source, /taskkill\.exe/);
assert.match(source, /Removed stale \.next\/dev\/lock/);
assert.match(source, /next dev --port 3000/);
assert.match(source, /not a Tany Messaging Next dev server\. It was not stopped/);
// HTTPS is opt-in (`npm run dev:https`); plain `npm run dev` keeps HTTP.
assert.match(source, /arg === "--https" \|\| arg === "--experimental-https"/);
assert.match(source, /const tls = httpsMode \? await require\("\.\/dev-https-cert\.cjs"\)\.ensureLocalCertificates/);
assert.match(source, /"--experimental-https", "--experimental-https-key", tls\.key, "--experimental-https-cert", tls\.cert/);
assert.match(source, /const httpsArgs = tls \? \[[^\n]*\] : \[\];/);
assert.match(source, /\[dev\]   \$\{url\}\/business\/demo-retail\/whatsapp\/setup/);
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(pkg.scripts.dev, "node scripts/start-dev.cjs");
assert.equal(pkg.scripts["dev:https"], "node scripts/start-dev.cjs --https");
const cert = fs.readFileSync("scripts/dev-https-cert.cjs", "utf8");
assert.match(cert, /const MKCERT_VERSION = "v1\.4\.4"/);
assert.match(cert, /if \(trust\) \{/, "the local CA is only trusted on explicit request");
assert.match(cert, /throw new Error\("mkcert did not produce a valid localhost certificate\."\)/, "no silent HTTP fallback");
assert.match(fs.readFileSync(".gitignore", "utf8"), /^\/certificates$/m);
console.log("PASS: Windows dev helper verifies ownership, preserves unrelated port listeners, clears only stale locks, and starts Next on port 3000 (HTTP by default, HTTPS via dev:https).");
