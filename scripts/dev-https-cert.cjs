/* eslint-disable @typescript-eslint/no-require-imports */
// Local-only HTTPS certificates for `next dev --experimental-https`.
// Uses the same mkcert release and cache directory as Next.js, but generates the
// localhost certificate up front so a failure stops the dev helper instead of
// Next silently falling back to HTTP. The local CA is only added to the OS trust
// store when explicitly requested (`npm run dev:https:trust`).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const MKCERT_VERSION = "v1.4.4"; // Matches next/dist/lib/mkcert.js
const certDir = path.join(process.cwd(), "certificates");
const keyPath = path.join(certDir, "localhost-key.pem");
const certPath = path.join(certDir, "localhost.pem");
const hosts = ["localhost", "127.0.0.1", "::1"];

function binaryName() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
  if (!arch) throw new Error(`mkcert is not available for ${process.arch}.`);
  if (process.platform === "win32") return `mkcert-${MKCERT_VERSION}-windows-${arch}.exe`;
  if (process.platform === "darwin") return `mkcert-${MKCERT_VERSION}-darwin-${arch}`;
  if (process.platform === "linux") return `mkcert-${MKCERT_VERSION}-linux-${arch}`;
  throw new Error(`mkcert is not available for ${process.platform}.`);
}

async function mkcertBinary() {
  const { getCacheDirectory } = require("next/dist/lib/helpers/get-cache-directory");
  const directory = getCacheDirectory("mkcert");
  const binaryPath = path.join(directory, binaryName());
  if (fs.existsSync(binaryPath)) return binaryPath;
  fs.mkdirSync(directory, { recursive: true });
  const url = `https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/${binaryName()}`;
  console.log(`[dev] Downloading mkcert ${MKCERT_VERSION} (local HTTPS certificates)…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`mkcert download failed: HTTP ${response.status}`);
  fs.writeFileSync(binaryPath, Buffer.from(await response.arrayBuffer()));
  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function certificatesValid() {
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) return false;
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
    return !!cert.checkHost("localhost") && cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyPath))) && new Date(cert.validTo) > new Date(Date.now() + 86_400_000);
  } catch { return false; }
}

function ensureGitignored() {
  const gitignore = path.join(process.cwd(), ".gitignore");
  if (fs.existsSync(gitignore) && !/^\/?certificates\/?$/m.test(fs.readFileSync(gitignore, "utf8")))
    fs.appendFileSync(gitignore, "\n# local HTTPS dev certificates\n/certificates\n");
}

/** Returns key/cert/CA paths for Next's --experimental-https-* flags. Throws on failure. */
async function ensureLocalCertificates({ trust = false } = {}) {
  const binary = await mkcertBinary();
  const caRoot = execFileSync(binary, ["-CAROOT"], { encoding: "utf8" }).trim();
  if (trust) {
    console.log("[dev] Installing the local mkcert CA into your user trust store (Windows may ask you to confirm)…");
    execFileSync(binary, ["-install"], { stdio: "inherit" });
  }
  if (!certificatesValid()) {
    fs.mkdirSync(certDir, { recursive: true });
    execFileSync(binary, ["-key-file", keyPath, "-cert-file", certPath, ...hosts], { stdio: "ignore" });
    if (!certificatesValid()) throw new Error("mkcert did not produce a valid localhost certificate.");
    console.log("[dev] Created local HTTPS certificate in ./certificates.");
  }
  ensureGitignored();
  const ca = path.join(caRoot, "rootCA.pem");
  return { key: keyPath, cert: certPath, ca: fs.existsSync(ca) ? ca : null };
}

module.exports = { ensureLocalCertificates, certificatesValid };

if (require.main === module) {
  ensureLocalCertificates({ trust: process.argv.includes("--trust") })
    .then(({ key, cert }) => console.log(`[dev] HTTPS certificate ready:\n  key  ${path.relative(process.cwd(), key)}\n  cert ${path.relative(process.cwd(), cert)}`))
    .catch((error) => { console.error(`[dev] Local HTTPS setup failed: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
}
