/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");

async function main() {
  loadEnvConfig(process.cwd());
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "requires explicit staging target");
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL required");
  const url = new URL(raw);
  assert.doesNotMatch(`${url.hostname}${url.pathname}`, /prod|production|live/i, "production target forbidden");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const phone1 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone2 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone3 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone4 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone5 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone6 = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const businessA = `otp-a-${suffix}`;
  const businessB = `otp-b-${suffix}`;
  const businessC = `otp-c-${suffix}`;
  const env = { target: process.env.MESSAGING_DATABASE, secret: process.env.TANY_PHONE_LOGIN_SECRET, serviceSecret: process.env.MESSAGING_SERVICE_SECRET, sid: process.env.TWILIO_ACCOUNT_SID, auth: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_PHONE_NUMBER };
  process.env.MESSAGING_DATABASE = "postgres";
  process.env.TANY_PHONE_LOGIN_SECRET = "staging-only-phone-login-secret-change-me-2026";
  process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
  process.env.TWILIO_AUTH_TOKEN = "staging-test-token";
  process.env.TWILIO_PHONE_NUMBER = "+15005550006";
  const client = new Client({ connectionString: raw });
  await client.connect();
  const codes = new Map();
  const originalFetch = global.fetch;
  try {
    await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status,products,settings) values($1,'OTP Single','retail','active','[]'::jsonb,'{}'::jsonb),($2,'OTP Multi A','retail','active','[]'::jsonb,'{}'::jsonb),($3,'OTP Multi B','eats','active','[]'::jsonb,'{}'::jsonb),($4,'OTP Other Tenant','motos','active','[]'::jsonb,'{}'::jsonb)", [businessA, businessB, `${businessB}-two`, businessC]);
    const insertUser = async (phone, businesses) => {
      const user = await client.query("insert into messaging_auth_users(phone,display_name) values($1,$2) returning id", [phone, `OTP ${phone.slice(-4)}`]);
      for (const businessId of businesses) await client.query("insert into messaging_auth_user_businesses(user_id,messaging_business_id) select $1,id from messaging_businesses where legacy_business_id=$2", [user.rows[0].id, businessId]);
    };
    await insertUser(phone1, [businessA]);
    await insertUser(phone2, [businessB, `${businessB}-two`]);
    await insertUser(phone3, [businessA]);
    await insertUser(phone4, [businessA]);
    await insertUser(phone5, [businessA]);

    global.fetch = async (_url, init) => {
      assert.match(String(_url), /^https:\/\/api\.twilio\.com\//);
      const message = new URLSearchParams(String(init.body)).get("Body");
      const code = message.match(/code is (\d{6})/)[1];
      const to = new URLSearchParams(String(init.body)).get("To");
      codes.set(to, code);
      return { ok: true, status: 201, json: async () => ({ sid: "SM-staging-test" }) };
    };

    const { requestPhoneLoginOtp, verifyPhoneLoginOtp, resolvePhoneLoginSession, listPhoneLoginBusinesses, selectPhoneLoginBusiness, PhoneLoginError } = await import("../lib/admin/phone-login-service.ts");
    const requestCode = (phone, ip) => requestPhoneLoginOtp(phone, ip);

    await requestCode(phone1, `single-${suffix}`);
    const firstCode = codes.get(phone1);
    const wrongCode = firstCode === "000000" ? "000001" : "000000";
    await assert.rejects(() => verifyPhoneLoginOtp(phone1, wrongCode), error => { if (!(error instanceof PhoneLoginError)) console.error("Unexpected OTP verification failure", error); return error instanceof PhoneLoginError && error.code === "INVALID_OTP"; });
    const single = await verifyPhoneLoginOtp(phone1, firstCode);
    assert.equal(single.businesses.length, 1);
    assert.equal(single.selectedBusinessId, businessA);
    assert.deepEqual(await resolvePhoneLoginSession(single.token), { role: "business", businessId: businessA });
    console.log("PASS valid OTP and single-business direct session");

    await requestCode(phone4, `expired-${suffix}`);
    await client.query("update messaging_phone_login_challenges set expires_at=now()-interval '1 second' where phone=$1", [phone4]);
    await assert.rejects(() => verifyPhoneLoginOtp(phone4, codes.get(phone4)), error => error instanceof PhoneLoginError && error.code === "OTP_EXPIRED");
    console.log("PASS expired OTP rejection");

    await requestCode(phone5, `retry-${suffix}`);
    const retryCode = codes.get(phone5);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await assert.rejects(() => verifyPhoneLoginOtp(phone5, retryCode === "000000" ? "000001" : "000000"), error => error instanceof PhoneLoginError && (attempt === 5 ? error.code === "RATE_LIMITED" : error.code === "INVALID_OTP"));
    }
    await assert.rejects(() => verifyPhoneLoginOtp(phone5, retryCode), error => error instanceof PhoneLoginError);
    console.log("PASS OTP retry limit");

    for (let attempt = 0; attempt < 5; attempt++) await requestCode(phone3, `rate-${suffix}`);
    await assert.rejects(() => requestCode(phone3, `rate-${suffix}`), error => error instanceof PhoneLoginError && error.code === "RATE_LIMITED");
    console.log("PASS OTP request rate limit");

    const concurrent = await Promise.allSettled(Array.from({ length: 6 }, () => requestCode(phone6, `concurrent-${suffix}`)));
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 5);
    assert.equal(concurrent.filter(result => result.status === "rejected" && result.reason.code === "RATE_LIMITED").length, 1);
    console.log("PASS concurrent OTP requests remain rate limited");

    await requestCode(phone2, `multi-${suffix}`);
    const multiple = await verifyPhoneLoginOtp(phone2, codes.get(phone2));
    assert.equal(multiple.businesses.length, 2);
    assert.equal(multiple.selectedBusinessId, null);
    assert.equal((await resolvePhoneLoginSession(multiple.token)).role, "selector");
    assert.equal((await listPhoneLoginBusinesses(multiple.token)).length, 2);
    await assert.rejects(() => selectPhoneLoginBusiness(multiple.token, businessC), error => error instanceof PhoneLoginError && error.code === "BUSINESS_FORBIDDEN");
    await selectPhoneLoginBusiness(multiple.token, businessB);
    assert.deepEqual(await resolvePhoneLoginSession(multiple.token), { role: "business", businessId: businessB });
    console.log("PASS multiple-business selector and tenant isolation");

    const { signIntegrationAccess } = await import("../lib/integration/access.ts");
    const { resolveDashboardSession } = await import("../lib/admin/dashboard-access.ts");
    const admin = await signIntegrationAccess("test-dashboard-secret-for-phone-login", { kind: "directory" }, Date.now(), "tany-dashboard-v1", 3600);
    assert.deepEqual(await resolveDashboardSession("test-dashboard-secret-for-phone-login", admin), { role: "admin" });
    console.log("PASS existing Super Admin session remains valid");
  } finally {
    global.fetch = originalFetch;
    await client.query("delete from messaging_phone_login_challenges where phone = any($1)", [[phone1, phone2, phone3, phone4, phone5, phone6]]);
    await client.query("delete from messaging_auth_users where phone = any($1)", [[phone1, phone2, phone3, phone4, phone5, phone6]]);
    await client.query("delete from messaging_businesses where legacy_business_id = any($1)", [[businessA, businessB, `${businessB}-two`, businessC]]);
    await client.end();
    for (const [key, value] of Object.entries({ MESSAGING_DATABASE: env.target, TANY_PHONE_LOGIN_SECRET: env.secret, MESSAGING_SERVICE_SECRET: env.serviceSecret, TWILIO_ACCOUNT_SID: env.sid, TWILIO_AUTH_TOKEN: env.auth, TWILIO_PHONE_NUMBER: env.from })) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
