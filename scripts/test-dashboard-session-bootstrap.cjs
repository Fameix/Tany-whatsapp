/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { createHarness } = require("./messaging-test-helpers.cjs");

async function main() {
  const before = {
    NODE_ENV: process.env.NODE_ENV,
    MESSAGING_SERVICE_SECRET: process.env.MESSAGING_SERVICE_SECRET,
  };
  process.env.NODE_ENV = "development";
  process.env.MESSAGING_SERVICE_SECRET = "local-dashboard-bootstrap-secret-".repeat(3);
  try {
    const h = createHarness({ seedFixtures: false });
    const bootstrap = h.load("app/api/dev/dashboard-session/route.ts");
    const request = (url, credential = process.env.MESSAGING_SERVICE_SECRET) =>
      new NextRequest(url, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
      });

    assert.equal(
      (await bootstrap.POST(request("http://localhost/api/dev/dashboard-session", "wrong"))).status,
      401,
    );
    assert.equal(
      (await bootstrap.POST(request("http://example.test/api/dev/dashboard-session"))).status,
      404,
    );
    const handoff = await bootstrap.POST(request("http://localhost/api/dev/dashboard-session"));
    assert.equal(handoff.status, 200);
    const { path } = await handoff.json();
    assert.match(path, /^\/api\/dashboard\/connect\?token=[a-f0-9]{64}$/);

    const connect = h.load("app/api/dashboard/connect/route.ts");
    const response = await connect.GET(new NextRequest(`http://localhost${path}`));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/admin");
    assert.match(response.headers.get("set-cookie"), /tany-dashboard-dev=/);
    assert.match(response.headers.get("set-cookie"), /Max-Age=604800/);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.doesNotMatch(response.headers.get("set-cookie"), /Secure/);

    const { resolveDashboardSession } = h.load("lib/admin/dashboard-access.ts");
    const cookie = response.cookies.get("tany-dashboard-dev").value;
    assert.deepEqual(
      await resolveDashboardSession(process.env.MESSAGING_SERVICE_SECRET, cookie),
      { role: "admin" },
    );
    assert.equal(
      (await connect.GET(new NextRequest(`http://localhost${path}`))).status,
      400,
    );
    console.log(
      "PASS: local directory handoff requires the server secret, is localhost-only and single-use, and creates a verified HttpOnly Super Admin session.",
    );
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
