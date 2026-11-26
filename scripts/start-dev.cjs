/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

const root = process.cwd();
const lockPath = path.join(root, ".next", "dev", "lock");
const psOptions = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TANY_MESSAGING_ROOT: root } };

function powershell(script) {
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], psOptions).trim();
    return output ? JSON.parse(output) : [];
  } catch (error) {
    const message = error && error.stderr ? String(error.stderr).trim() : "PowerShell inspection failed.";
    throw new Error(message);
  }
}
function processTree(pid) {
  return powershell(`$id = ${Number(pid)}; $seen = @{}; $items = @(); for ($i = 0; $i -lt 16 -and $id -and -not $seen[$id]; $i++) { $seen[$id] = $true; $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$id\" -ErrorAction SilentlyContinue; if (-not $p) { break }; $items += [pscustomobject]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; name = [string]$p.Name; commandLine = [string]$p.CommandLine }; $id = $p.ParentProcessId }; $items | ConvertTo-Json -Compress`);
}
function portListeners() {
  return powershell("$ErrorActionPreference = 'SilentlyContinue'; $connections = @(Get-NetTCPConnection -LocalPort 3000 -State Listen); if ($connections.Count -eq 0) { '[]' } else { $connections | ForEach-Object { [pscustomobject]@{ pid = [int]$_.OwningProcess } } | ConvertTo-Json -Compress }; exit 0");
}
function activeProjectDevProcesses() {
  return powershell("$root = $env:TANY_MESSAGING_ROOT.ToLowerInvariant(); Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($root) -and $_.CommandLine.ToLowerInvariant().Contains('next') -and $_.CommandLine.ToLowerInvariant().Contains(' dev') } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; commandLine = [string]$_.CommandLine } } | ConvertTo-Json -Compress");
}
function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function isProjectNextDev(tree) {
  const normalizedRoot = root.toLowerCase();
  return tree.some((entry) => String(entry.commandLine ?? "").toLowerCase().includes(normalizedRoot)) && tree.some((entry) => {
    const command = String(entry.commandLine ?? "").toLowerCase();
    return command.includes("next") && command.includes(" dev");
  });
}
function nextDevPid(tree, fallbackPid) {
  return tree.find((entry) => {
    const command = String(entry.commandLine ?? "").toLowerCase();
    return command.includes("next") && command.includes(" dev");
  })?.pid ?? fallbackPid;
}
function stopProjectDev(pid) {
  const result = spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not stop the existing Tany Messaging dev server (PID ${pid}).`);
}
function waitForPortRelease() {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    if (asArray(portListeners()).length === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  throw new Error("Port 3000 did not become available after stopping the Tany Messaging dev server.");
}
function removeStaleLock() {
  if (!fs.existsSync(lockPath)) return;
  if (asArray(activeProjectDevProcesses()).length > 0) {
    throw new Error("A Tany Messaging Next dev process is still active, so its .next/dev/lock was left untouched.");
  }
  try {
    fs.unlinkSync(lockPath);
    console.log("[dev] Removed stale .next/dev/lock.");
  } catch (error) {
    throw new Error(`Could not remove stale .next/dev/lock: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
// `--https` (or Next's `--experimental-https`) serves local HTTPS; anything else keeps HTTP.
const httpsMode = process.argv.slice(2).some((arg) => arg === "--https" || arg === "--experimental-https");
const trustCa = process.argv.includes("--trust");
const quote = (value) => `"${value}"`;

async function main() {
  const tls = httpsMode ? await require("./dev-https-cert.cjs").ensureLocalCertificates({ trust: trustCa }) : null;
  const listeners = asArray(portListeners());
  for (const listener of listeners) {
    const tree = asArray(processTree(listener.pid));
    if (!isProjectNextDev(tree)) {
      console.error(`[dev] Port 3000 is occupied by PID ${listener.pid}, which is not a Tany Messaging Next dev server. It was not stopped.`);
      process.exitCode = 1;
      return;
    }
    const owner = nextDevPid(tree, listener.pid);
    console.log(`[dev] Stopping existing Tany Messaging Next dev server (PID ${owner}) on port 3000.`);
    stopProjectDev(owner);
    waitForPortRelease();
  }
  removeStaleLock();
  const httpsArgs = tls ? ["--experimental-https", "--experimental-https-key", tls.key, "--experimental-https-cert", tls.cert, ...(tls.ca ? ["--experimental-https-ca", tls.ca] : [])] : [];
  const url = `${tls ? "https" : "http"}://localhost:3000`;
  console.log(`[dev] Starting Tany Messaging Next dev server on ${url}.`);
  if (tls) {
    console.log("[dev] HTTPS ready for Meta Embedded Signup:");
    console.log(`[dev]   ${url}/business/demo-retail/whatsapp/setup`);
    if (!trustCa) console.log('[dev]   If the browser warns about the certificate, run "npm run dev:https:trust" once.');
  }
  const command = ["next dev --port 3000", ...httpsArgs.map((arg) => (arg.startsWith("--") ? arg : quote(arg)))].join(" ");
  const child = spawn(process.platform === "win32" ? "cmd.exe" : process.execPath, process.platform === "win32" ? ["/d", "/s", "/c", quote(command)] : [require.resolve("next/dist/bin/next"), "dev", "--port", "3000", ...httpsArgs], { cwd: root, stdio: "inherit", shell: false, windowsVerbatimArguments: process.platform === "win32" });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
main().catch((error) => { console.error(`[dev] ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
