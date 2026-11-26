/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");

const component = fs.readFileSync("app/dashboard/messaging/_components/whatsapp-connection.tsx", "utf8");
const page = fs.readFileSync("app/dashboard/messaging/setup/page.tsx", "utf8");

// The component launches Meta only through the tested helper, with the server-provided config ID.
assert.match(component, /launchEmbeddedSignupLogin\(sdk, embeddedSignup\.configId, \(response\) => \{ void handleLoginResponse\(response\); \}, \{ window, appId: embeddedSignup\.appId \}\)/);
assert.match(component, /sdkAppId: maskMetaId\(embeddedSignup\.appId\), sdkConfigId: maskMetaId\(embeddedSignup\.configId\)/);
assert.doesNotMatch(component, /console\.\w+\([^;]*(?<!maskMetaId\()embeddedSignup\.(appId|configId)\b/, "diagnostics must never log full Meta IDs");
assert.doesNotMatch(component, /sdk\.login\(/, "FB.login must only be called via launchEmbeddedSignupLogin");
assert.match(component, /embeddedSignupConfigIdPattern\.test\(embeddedSignup\.configId\.trim\(\)\)/);
// sdk.js defines a buffering window.FB stub, so readiness must come from fbAsyncInit.
assert.match(component, /fbAsyncInit = \(\) =>/);
assert.match(component, /script\.onerror/);
assert.match(component, /setSdkStatus\("failed"\)/);
// Exchange goes to the existing endpoint with the current business context.
assert.match(component, /\/api\/dashboard\/whatsapp-embedded-signup\?businessId=\$\{encodeURIComponent\(businessId\)\}/);
// Two-step progress only; no technical stepper or setup tabs.
assert.match(component, /label: "Connection"/);
assert.match(component, /label: "Complete"/);
assert.doesNotMatch(component, /Verify Business Number/);
assert.match(component, /Connect with Meta/);
assert.doesNotMatch(page, /WhatsApp setup navigation/);
assert.match(page, /verifyWhatsAppSetupSession\(secret, setupCredential, requestedBusinessId\)/);

// Verify the Meta SDK assertion behaviour this guards against.
const typeOf = (value) => /\s(\w*)/.exec({}.toString.call(value))[1].toLowerCase();
assert.equal(typeOf(async () => {}), "asyncfunction");
assert.equal(typeOf(() => {}), "function");

async function main() {
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
  const envConfigId = (process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ?? "").trim();
  const { embeddedSignupClientConfiguration } = await import("../lib/whatsapp/embedded-signup-service.ts");
  const { launchEmbeddedSignupLogin, EmbeddedSignupConfigError, embeddedSignupPopupDiagnostics, maskMetaId } = await import("../lib/whatsapp/embedded-signup-login.ts");

  // Exercise the actual FB.login call with a recording SDK.
  const calls = [];
  // Like Meta's SDK: FB.login synchronously opens the dialog/oauth popup with options as query params.
  const opened = [];
  const fakeWindow = { open: (url) => { opened.push(url); return {}; } };
  const fakeSdk = {
    login: (callback, options) => {
      calls.push({ callback, options });
      const appId = process.env.NEXT_PUBLIC_META_APP_ID;
      const url = new URL("https://www.facebook.com/v27.0/dialog/oauth");
      url.searchParams.set("app_id", appId); url.searchParams.set("client_id", appId);
      for (const [key, value] of Object.entries(options)) url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      fakeWindow.open(url.toString(), "_blank");
    },
  };
  const config = embeddedSignupClientConfiguration();
  if (envConfigId) {
    assert.ok(config, ".env.local config must produce a client Embedded Signup configuration");
    assert.equal(config.configId, envConfigId, "config ID must come from NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID");
    launchEmbeddedSignupLogin(fakeSdk, config.configId, () => {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.config_id, envConfigId, "FB.login options must carry config_id from the env");
  }
  process.env.NEXT_PUBLIC_META_APP_ID = "1234567890";
  process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = " 987654321012345\r";
  opened.length = 0;
  const result = launchEmbeddedSignupLogin(fakeSdk, embeddedSignupClientConfiguration().configId, () => {}, { window: fakeWindow, appId: "1234567890" });
  const sent = calls.at(-1);
  assert.deepEqual(result.diagnostics, {
    popupOpened: true, dialog: "www.facebook.com/v27.0/dialog/oauth", appId: "…7890", configId: "…2345",
    appIdMatch: true, configIdMatch: true, extras: JSON.stringify({ setup: {} }),
  });
  assert.equal(opened.length, 1);
  assert.equal(typeof fakeWindow.open, "function");
  assert.equal(fakeWindow.open.name, "open", "window.open must be restored after launch");
  // A login.php hop carries the dialog URL in `next`; a wrong app is reported as a mismatch.
  const hop = `https://www.facebook.com/login.php?next=${encodeURIComponent("https://www.facebook.com/v27.0/dialog/oauth?app_id=1111&config_id=987654321012345")}`;
  assert.deepEqual(
    (({ appIdMatch, configIdMatch, appId }) => ({ appIdMatch, configIdMatch, appId }))(embeddedSignupPopupDiagnostics(hop, { appId: "1234567890", configId: "987654321012345" })),
    { appIdMatch: false, configIdMatch: true, appId: "…1111" },
  );
  assert.equal(embeddedSignupPopupDiagnostics(null, { appId: "1", configId: "2" }).popupOpened, false);
  assert.equal(maskMetaId("987654321012345"), "…2345");
  assert.deepEqual(sent.options, {
    config_id: "987654321012345",
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {} },
  });
  assert.doesNotMatch(JSON.stringify(sent.options), /sessionInfoVersion|"version"|v3/, "deprecated v3 Embedded Signup extras must not be sent");
  assert.equal(typeOf(sent.callback), "function", "FB.login callback must be a plain function, not async");

  // Missing or malformed config IDs fail before Meta is opened.
  for (const bad of ["", "   ", "undefined", "<CONFIG_ID>"]) {
    process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID = bad;
    assert.equal(embeddedSignupClientConfiguration(), null, `config ${JSON.stringify(bad)} must be rejected server-side`);
    const before = calls.length;
    assert.throws(() => launchEmbeddedSignupLogin(fakeSdk, bad, () => {}), EmbeddedSignupConfigError);
    assert.equal(calls.length, before, "FB.login must not be called without a valid config_id");
  }
  delete process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
  assert.equal(embeddedSignupClientConfiguration(), null);

  console.log(`PASS FB.login receives config_id from NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID${envConfigId ? " (.env.local value verified)" : ""}; missing/invalid config fails before Meta opens.`);
}

console.log("PASS WhatsApp onboarding: plain FB.login callback, SDK readiness/failure handling, business-scoped exchange, 2-step UI without setup tabs.");
main().catch((error) => { console.error(error); process.exit(1); });
