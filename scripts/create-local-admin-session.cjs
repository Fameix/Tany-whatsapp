/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { loadEnvConfig } = require("@next/env");

async function main() {
  loadEnvConfig(path.resolve(__dirname, ".."));
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  if (secret.length < 32)
    throw new Error("MESSAGING_SERVICE_SECRET must be configured with at least 32 characters.");
  const origin = process.env.TANY_MESSAGING_LOCAL_ORIGIN ?? "http://localhost:3000";
  const response = await fetch(`${origin}/api/dev/dashboard-session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`Local dashboard handoff failed (${response.status}).`);
  const { path: handoffPath } = await response.json();
  if (typeof handoffPath !== "string" || !handoffPath.startsWith("/api/dashboard/connect?token="))
    throw new Error("Local dashboard handoff returned an invalid path.");
  console.log(`Open this one-time local URL in your browser:\n${origin}${handoffPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
