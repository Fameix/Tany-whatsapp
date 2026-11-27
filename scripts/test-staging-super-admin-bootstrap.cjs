/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { createHarness } = require("./messaging-test-helpers.cjs");

const staging = "https://tany-whatsapp.tany-8b9.workers.dev";
const localhost = "http://127.0.0.1:3199";
const secret = "staging-admin-test-service-secret-2026";

async function main() {
  Object.assign(process.env, {
    NODE_ENV: "production", // Staging Workers also use production builds.
    TANY_DEPLOYMENT_ENV: "staging",
    MESSAGING_POSTGRES_TARGET: "staging",
    MESSAGING_DATABASE: "postgres",
    DATABASE_URL: "postgresql://ep-shiny-boat-bifvzzhe-pooler.c-5.ap-southeast-1.aws.neon.tech/neondb",
    MESSAGING_SERVICE_SECRET: secret,
  });
  const stagingEnv = { ...process.env };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const runtime = (userAgent) => Object.defineProperty(globalThis, "navigator", {
    value: { userAgent }, configurable: true,
  });
  runtime("Cloudflare-Workers");
  try {
    const h = createHarness({ seedFixtures: false });
    const { proxy } = h.load("proxy.ts");
    const { verifyDirectorySession } = h.load("lib/admin/directory-session.ts");
    const { resolveDashboardSession } = h.load("lib/admin/dashboard-access.ts");
    const { signIntegrationAccess } = h.load("lib/integration/access.ts");
    const { dashboardSessionCookieName: cookie } = h.load("lib/admin/dashboard-cookie.ts");
    const target = new URL(staging).host;
    const visit = (url, headers = {}, method = "GET") => proxy(new NextRequest(url, { headers, method }));
    const assertUnchanged = (response) => {
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("set-cookie"), null);
    };
    const real = await signIntegrationAccess(secret, { kind: "directory" }, Date.now(), "tany-dashboard-v1");
    const business = await signIntegrationAccess(secret, { kind: "business", businessId: "test-retail" }, Date.now(), "tany-dashboard-v1");

    const first = await visit(staging + "/admin");
    assert.equal(first.status, 307);
    const bounce = first.headers.get("location");
    assert.equal(new URL(bounce).pathname, "/admin");
    assert.match(first.headers.get("cache-control"), /no-store/);
    assert.match(first.headers.get("set-cookie"), /^__Host-tany-dashboard=/);
    for (const flag of ["Secure", "HttpOnly", "SameSite=lax", "Path=/"]) {
      assert.ok(first.headers.get("set-cookie").includes(flag));
    }
    assert.doesNotMatch(first.headers.get("set-cookie"), /Domain=/i);
    const signed = first.cookies.get(cookie).value;
    assert.deepEqual(await resolveDashboardSession(secret, signed, target), { role: "admin" });
    assertUnchanged(await visit(bounce)); // Cookie blocked: the loop stops.
    for (const route of ["/admin", "/admin/products/retail", "/admin/products/eats",
      "/admin/products/motos", "/admin/products/retail/whatsapp"]) {
      assertUnchanged(await visit(staging + route, { cookie: cookie + "=" + signed }));
    }
    assertUnchanged(await visit(staging + "/admin", { cookie: cookie + "=" + real }));
    const deepLink = await visit(staging + "/admin/products/retail/whatsapp?business=test-retail");
    assert.equal(new URL(deepLink.headers.get("location")).searchParams.get("business"), "test-retail");
    assertUnchanged(await visit(staging + "/admin", {}, "POST"));
    console.log("PASS staging provisions a signed host-only directory session in one redirect and preserves deep links");

    for (const path of ["/business/test-retail", "/dashboard"]) {
      assertUnchanged(await visit(staging + path));
      assertUnchanged(await visit(staging + path, { cookie: cookie + "=" + business }));
      assertUnchanged(await visit(staging + path + "?_staging_session=1&staging=true"));
    }
    assert.deepEqual(await resolveDashboardSession(secret, business, target), { role: "business", businessId: "test-retail" });
    console.log("PASS /business and /dashboard do not get the staging admin bootstrap");

    assertUnchanged(await visit("https://production.example/admin?staging=true", { host: target }));
    assertUnchanged(await visit(staging + "/admin", { host: "production.example" }));
    assertUnchanged(await visit(staging.replace("https:", "http:") + "/admin"));
    assert.equal(await verifyDirectorySession(secret, signed, "production.example"), false);
    for (const settings of [
      { TANY_DEPLOYMENT_ENV: "" },
      { TANY_DEPLOYMENT_ENV: "production" },
      { MESSAGING_POSTGRES_TARGET: "production" },
      { DATABASE_URL: "postgresql://production.example/neondb" },
    ]) {
      Object.assign(process.env, stagingEnv, settings);
      assertUnchanged(await visit(staging + "/admin?staging=true&target=staging"));
      assertUnchanged(await visit(staging + "/admin", { cookie: cookie + "=" + signed }));
      assert.equal(await verifyDirectorySession(secret, signed, target), false);
      assert.equal(await verifyDirectorySession(secret, real, target), true);
    }

    Object.assign(process.env, stagingEnv, { NODE_ENV: "development" });
    runtime("Node.js");
    assertUnchanged(await visit(staging + "/admin", { "user-agent": "Cloudflare-Workers" }));
    assert.equal(await verifyDirectorySession(secret, signed, target), false);
    const local = await visit(localhost + "/admin");
    const localCookie = local.cookies.get("tany-dashboard-dev").value;
    assert.deepEqual(await resolveDashboardSession(secret, localCookie), { role: "admin" });
    assertUnchanged(await visit(localhost + "/dashboard"));

    process.env.TANY_DEPLOYMENT_ENV = "production";
    assertUnchanged(await visit(localhost + "/admin?staging=true"));
    process.env.TANY_DEPLOYMENT_ENV = "staging";
    process.env.MESSAGING_POSTGRES_TARGET = "production";
    assertUnchanged(await visit(localhost + "/admin?staging=true"));
    console.log("PASS localhost development only; production runtime, hostname, database and query activation guards fail closed");
  } finally {
    Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
