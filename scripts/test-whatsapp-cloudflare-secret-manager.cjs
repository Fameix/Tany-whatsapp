const b64url = value => Buffer.from(value, "base64url");

async function main() {
  const assert = (await import("node:assert/strict")).default;
  const { generateKeyPairSync, verify } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials = {
    GCP_SERVICE_ACCOUNT_EMAIL: "staging-messaging@test-project.iam.gserviceaccount.com",
    GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID: "test-key-id",
    GCP_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const { createCloudflareSecretManagerAdapter, createGoogleAdcSecretManagerAdapter } = await import("../lib/whatsapp/credentials.ts");
  const metaToken = `mock-meta-token-${"x".repeat(40)}`;
  let storedSecretValue = "";
  let oauthExchanges = 0;
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (url === "https://oauth2.googleapis.com/token") {
      oauthExchanges += 1;
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const parts = params.get("assertion").split(".");
      const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
      assert.equal(verify("RSA-SHA256", signed, publicKey, b64url(parts[2])), true, "service-account JWT must be correctly signed");
      const claims = JSON.parse(b64url(parts[1]).toString("utf8"));
      assert.equal(claims.iss, credentials.GCP_SERVICE_ACCOUNT_EMAIL);
      assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
      return Response.json({ access_token: "mock-google-access-token", expires_in: 3600 });
    }
    if (String(url).includes("/secrets?secretId=")) {
      assert.equal(init.method, "POST");
      return Response.json({ error: { status: "ALREADY_EXISTS" } }, { status: 409 });
    }
    if (String(url).endsWith(":addVersion")) {
      const payload = JSON.parse(init.body);
      storedSecretValue = Buffer.from(payload.payload.data, "base64").toString("utf8");
      return Response.json({ name: "staging-secret-version" });
    }
    if (String(url).endsWith("/versions/latest:access")) {
      return Response.json({ payload: { data: Buffer.from(storedSecretValue, "utf8").toString("base64") } });
    }
    throw new Error(`Unexpected mocked fetch: ${init.method ?? "GET"} ${url}`);
  };

  const adapter = createCloudflareSecretManagerAdapter({ credentials, fetcher, now: () => 1_800_000_000_000 });
  await adapter.writeSecret("tany-whatsapp", "TANY_WA_DEMO_RETAIL_META_TOKEN", metaToken);
  assert.equal(storedSecretValue, metaToken, "mock Secret Manager write stores the credential payload");
  const read = await adapter.readSecret("tany-whatsapp", "TANY_WA_DEMO_RETAIL_META_TOKEN");
  assert.equal(read, metaToken, "mock Secret Manager read returns the stored credential");
  assert.equal(calls.some(call => call.url.includes("projects/tany-whatsapp/")), true);
  assert.equal(calls.some(call => call.url.includes("projects/test-project/")), false, "configured service-account project is never used as resource scope");
  console.log("PASS Cloudflare service-account token write/read");

  assert.throws(() => createCloudflareSecretManagerAdapter({ credentials: {}, fetcher }), /credentials are not configured/);
  console.log("PASS missing Cloudflare credentials fail closed");

  const escapedKey = credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY.trim().replace(/\r?\n/g, "\\n");
  const pasted = { GCP_SERVICE_ACCOUNT_EMAIL: `"${credentials.GCP_SERVICE_ACCOUNT_EMAIL}"`, GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID: ` ${credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID} `, GCP_SERVICE_ACCOUNT_PRIVATE_KEY: `"${escapedKey}"` };
  const pastedCalls = calls.length;
  await createCloudflareSecretManagerAdapter({ credentials: pasted, fetcher }).writeSecret("tany-whatsapp", "TANY_WA_DEMO_RETAIL_META_TOKEN", metaToken);
  assert.ok(calls.length > pastedCalls, "quoted values and escaped \\n keys still sign a valid service-account JWT");
  assert.throws(() => createCloudflareSecretManagerAdapter({ credentials: { GCP_SERVICE_ACCOUNT_EMAIL: "owner@example.com", GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID: "id", GCP_SERVICE_ACCOUNT_PRIVATE_KEY: "key" }, fetcher }), /credentials are not configured/, "a non-service-account email fails closed");
  console.log("PASS pasted quotes or escaped newlines are accepted, and invalid credentials fail closed");

  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  const { storeEmbeddedSignupAccessToken: storeWithFailure, installWhatsAppSecretManagerAdapter } = await import("../lib/whatsapp/credentials.ts");
  installWhatsAppSecretManagerAdapter(async () => createCloudflareSecretManagerAdapter({ credentials, fetcher: async () => Response.json({ error: "invalid_grant", error_description: `Invalid JWT Signature ${"A".repeat(40)} Bearer short-tok` }, { status: 400 }) }));
  const previousProject = process.env.WHATSAPP_TOKEN_SECRET_PROJECT;
  process.env.WHATSAPP_TOKEN_SECRET_PROJECT = "tany-whatsapp";
  try { await assert.rejects(storeWithFailure("demo-retail", metaToken)); }
  finally {
    console.error = originalError;
    installWhatsAppSecretManagerAdapter(undefined);
    if (previousProject === undefined) delete process.env.WHATSAPP_TOKEN_SECRET_PROJECT; else process.env.WHATSAPP_TOKEN_SECRET_PROJECT = previousProject;
  }
  const failure = logged.find(line => line.includes("SECRET_STORE_FAILED")) ?? "";
  assert.match(failure, /"operation":"oauth-token","httpStatus":400,"googleCode":"invalid_grant"/, "failure log names the failing Google call");
  assert.equal(failure.includes(metaToken) || failure.includes("A".repeat(40)), false, "failure log never contains the token or token-like values");
  assert.equal(failure.includes("short-tok"), false, "short bearer values are redacted too");
  assert.match(failure, /Bearer <redacted>/);
  console.log("PASS storage failure logs one sanitized line naming the failing Google operation");

  const wrongProjectCalls = calls.length;
  await assert.rejects(adapter.readSecret("another-project", "TANY_WA_DEMO_RETAIL_META_TOKEN"), /restricted to project tany-whatsapp/);
  assert.equal(calls.length, wrongProjectCalls, "wrong-project access performs no network request");
  console.log("PASS wrong project is rejected before network access");

  let adcConstructorCalls = 0;
  let adcReadUrl = "";
  const adcAdapter = await createGoogleAdcSecretManagerAdapter(class {
    constructor(options) {
      adcConstructorCalls += 1;
      assert.deepEqual(options.scopes, ["https://www.googleapis.com/auth/cloud-platform"]);
    }
    async getClient() {
      return { request: async ({ url }) => { adcReadUrl = url; return { data: { payload: { data: Buffer.from("adc-regression").toString("base64") } } }; } };
    }
  });
  assert.equal(await adcAdapter.readSecret("tany-whatsapp", "local-test-secret"), "adc-regression");
  assert.equal(adcConstructorCalls, 1);
  assert.match(adcReadUrl, /projects\/tany-whatsapp\/secrets\/local-test-secret/);
  console.log("PASS local ADC adapter path remains available");

  const { accountAccessToken } = await import("../lib/whatsapp/credentials.ts");
  const previousLegacy = {
    mode: process.env.MESSAGING_DATABASE,
    names: process.env.WHATSAPP_TOKEN_SECRET_NAMES,
    bindings: process.env.WHATSAPP_TOKEN_SECRET_BINDINGS,
    token: process.env.LEGACY_META_TOKEN,
  };
  process.env.MESSAGING_DATABASE = "postgres";
  process.env.WHATSAPP_TOKEN_SECRET_NAMES = "LEGACY_META_TOKEN";
  process.env.WHATSAPP_TOKEN_SECRET_BINDINGS = JSON.stringify({ "demo-retail": "LEGACY_META_TOKEN" });
  process.env.LEGACY_META_TOKEN = metaToken;
  assert.equal(await accountAccessToken("LEGACY_META_TOKEN", "demo-retail"), null, "Postgres mode never reads raw Meta tokens from environment variables");
  const restoreLegacy = (name, value) => value === undefined ? delete process.env[name] : process.env[name] = value;
  restoreLegacy("MESSAGING_DATABASE", previousLegacy.mode);
  restoreLegacy("WHATSAPP_TOKEN_SECRET_NAMES", previousLegacy.names);
  restoreLegacy("WHATSAPP_TOKEN_SECRET_BINDINGS", previousLegacy.bindings);
  restoreLegacy("LEGACY_META_TOKEN", previousLegacy.token);
  console.log("PASS Postgres mode has no raw environment-token fallback");

  // Exercise automatic Cloudflare runtime selection, not just the adapter directly.
  const original = {
    WebSocketPair: globalThis.WebSocketPair,
    fetch: globalThis.fetch,
    email: process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    keyId: process.env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID,
    privateKey: process.env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY,
    project: process.env.WHATSAPP_TOKEN_SECRET_PROJECT,
    target: process.env.MESSAGING_POSTGRES_TARGET,
    mode: process.env.MESSAGING_DATABASE,
  };
  try {
    globalThis.WebSocketPair = class WebSocketPair {};
    globalThis.fetch = fetcher;
    process.env.GCP_SERVICE_ACCOUNT_EMAIL = credentials.GCP_SERVICE_ACCOUNT_EMAIL;
    process.env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID = credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID;
    process.env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY = credentials.GCP_SERVICE_ACCOUNT_PRIVATE_KEY;
    process.env.WHATSAPP_TOKEN_SECRET_PROJECT = "tany-whatsapp";
    process.env.MESSAGING_POSTGRES_TARGET = "staging";
    process.env.MESSAGING_DATABASE = "postgres";
    const { storeEmbeddedSignupAccessToken, managedTokenSecretName } = await import("../lib/whatsapp/credentials.ts");
    assert.equal(await storeEmbeddedSignupAccessToken("demo-retail", metaToken), managedTokenSecretName("demo-retail"));
    console.log("PASS Cloudflare runtime auto-selects service-account adapter");
  } finally {
    if (original.WebSocketPair === undefined) delete globalThis.WebSocketPair; else globalThis.WebSocketPair = original.WebSocketPair;
    globalThis.fetch = original.fetch;
    const restore = (name, value) => value === undefined ? delete process.env[name] : process.env[name] = value;
    restore("GCP_SERVICE_ACCOUNT_EMAIL", original.email);
    restore("GCP_SERVICE_ACCOUNT_PRIVATE_KEY_ID", original.keyId);
    restore("GCP_SERVICE_ACCOUNT_PRIVATE_KEY", original.privateKey);
    restore("WHATSAPP_TOKEN_SECRET_PROJECT", original.project);
    restore("MESSAGING_POSTGRES_TARGET", original.target);
    restore("MESSAGING_DATABASE", original.mode);
  }
  assert.ok(oauthExchanges >= 1);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
