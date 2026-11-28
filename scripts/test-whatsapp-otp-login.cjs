/* eslint-disable @typescript-eslint/no-require-imports */
// WhatsApp OTP sign-in: the code is sent from the business's own connected number with its approved
// Authentication template; challenges, limits and sessions are per business + phone; only the code's
// HMAC is stored; the session is locked to that business. The real SQL runs against the confirmed
// staging database inside ONE transaction that is always rolled back (also behind a pooler): on
// temporary copies of the sign-in tables, or with OTP_TEST_REAL_TABLES=1 on the real migrated tables.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");

async function main() {
  // 1. Pure rules: payload, cooldown, sender choice.
  const model = await import("../lib/auth/whatsapp-otp-model.ts");
  const payload = model.authenticationTemplatePayload("+919876543210", "042137", { name: "login_code", language: "en_US" });
  assert.deepEqual(payload, {
    messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "template",
    template: { name: "login_code", language: { code: "en_US" }, components: [
      { type: "body", parameters: [{ type: "text", text: "042137" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "042137" }] },
    ] },
  });
  assert.throws(() => model.authenticationTemplatePayload("+919876543210", "12345", { name: "x", language: "en" }));
  const now = Date.now();
  assert.equal(model.resendWaitSeconds(null, now), 0);
  assert.equal(model.resendWaitSeconds(new Date(now - 10_000), now), 50);
  assert.equal(model.resendWaitSeconds(new Date(now - 61_000), now), 0);
  assert.equal(model.whatsappOtpTtlMs, 5 * 60_000);
  const business = { active: true, whatsappPhoneNumberId: "111" };
  const account = { businessId: "shop", status: "connected", phoneNumberId: "111" };
  const auth = { name: "login_code", language: "en", status: "approved", storedCategory: "authentication" };
  const choose = (...args) => model.chooseWhatsAppOtpSender("shop", ...args);
  assert.deepEqual(choose(business, account, [auth]), { businessId: "shop", phoneNumberId: "111", template: { name: "login_code", language: "en" } });
  assert.equal(choose({ ...business, active: false }, account, [auth]), "BUSINESS_INACTIVE");
  assert.equal(choose(null, account, [auth]), "BUSINESS_INACTIVE");
  assert.equal(choose({ ...business, whatsappPhoneNumberId: "" }, account, [auth]), "NOT_CONNECTED");
  assert.equal(choose(business, null, [auth]), "NOT_CONNECTED");
  for (const status of ["disconnected", "pending", "error", "configured"]) assert.equal(choose(business, { ...account, status }, [auth]), "NOT_CONNECTED", status);
  assert.equal(choose(business, { ...account, phoneNumberId: "222" }, [auth]), "NOT_CONNECTED", "the number must be this business's own");
  assert.equal(choose(business, { ...account, businessId: "other-shop" }, [auth]), "NOT_CONNECTED", "never another business's account");
  assert.equal(choose(business, account, []), "NO_AUTH_TEMPLATE");
  assert.equal(choose(business, account, [{ ...auth, status: "pending" }, { ...auth, storedCategory: "utility" }, { ...auth, status: "rejected" }]), "NO_AUTH_TEMPLATE", "only an approved Authentication template");
  console.log("PASS Meta Authentication payload; 60s resend cooldown; 5-minute expiry; only the business's own connected number with an approved Authentication template sends codes");

  // 2. Real SQL on temporary tables in the confirmed staging database.
  loadEnvConfig(process.cwd());
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET, "staging", "requires explicit staging target");
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, "DATABASE_URL required");
  assert.doesNotMatch(`${new URL(raw).hostname}${new URL(raw).pathname}`, /prod|production|live/i, "production target forbidden");
  const { isConfirmedStagingDatabase } = await import("../lib/admin/staging-environment.ts");
  assert.ok(isConfirmedStagingDatabase({ ...process.env, MESSAGING_DATABASE: "postgres" }), "requires the confirmed staging database");
  process.env.TANY_PHONE_LOGIN_SECRET = "staging-only-phone-login-secret-change-me-2026";
  const client = new Client({ connectionString: raw });
  await client.connect();
  const logs = [];
  const pass = message => process.stdout.write(`${message}\n`);
  const originalError = console.error, originalLog = console.log, originalInfo = console.info, originalWarn = console.warn;
  try {
    const tables = ["messaging_businesses", "messaging_auth_users", "messaging_auth_user_businesses", "messaging_phone_login_challenges", "messaging_phone_login_sessions"];
    // One outer transaction, rolled back at the end: a connection pooler keeps a transaction on one
    // server session, and nothing persists even if a statement reached a real table.
    // OTP_TEST_REAL_TABLES=1 (after migration 0010): the real tables and columns, still rolled back.
    const realTables = process.env.OTP_TEST_REAL_TABLES === "1";
    await client.query("begin");
    if (!realTables) {
      for (const table of tables) {
        await client.query(`drop table if exists pg_temp.${table}`);
        await client.query(`create temporary table ${table} (like public.${table} including defaults including indexes) on commit drop`);
      }
      await client.query("alter table pg_temp.messaging_phone_login_challenges add column if not exists messaging_business_id uuid");
      await client.query("alter table pg_temp.messaging_phone_login_sessions add column if not exists tenant_locked boolean not null default false");
    }
    for (const table of tables) {
      const where = await client.query("select n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.oid=$1::regclass", [table]);
      assert.match(where.rows[0].nspname, realTables ? /^public$/ : /^pg_temp/, `${table} resolves to the ${realTables ? "real table" : "temporary copy"}`);
    }
    pass(realTables ? "(real migrated tables, one transaction, rolled back)" : "(temporary copies of the tables, one transaction, rolled back)");
    // The service's own transactions become savepoints inside the outer one.
    const savepoints = [];
    let next = 0;
    const query = (statement, values) => {
      const verb = statement.trim().toLowerCase();
      if (verb === "begin") { savepoints.push(`sp${++next}`); return client.query(`savepoint ${savepoints.at(-1)}`); }
      if (verb === "commit") return client.query(`release savepoint ${savepoints.pop()}`);
      // As in Postgres, a rollback after commit (nothing open) does nothing.
      if (verb === "rollback") { const name = savepoints.pop(); return name ? client.query(`rollback to savepoint ${name}`).then(() => client.query(`release savepoint ${name}`)) : Promise.resolve(); }
      return client.query(statement, values);
    };
    const pool = { connect: async () => ({ query, release() {} }) };
    const addBusiness = async (id, vertical, status = "active") => (await client.query("insert into messaging_businesses(legacy_business_id,name,vertical,status,products,settings) values($1,$2,$3,$4,'[]'::jsonb,'{}'::jsonb) returning id", [id, `Shop ${id}`, vertical, status])).rows[0].id;
    const tenantA = await addBusiness("otp-shop-a", "retail");
    const tenantB = await addBusiness("otp-shop-b", "eats");
    await addBusiness("otp-shop-off", "motos", "inactive");
    const addUser = async (phone, tenants) => {
      const user = (await client.query("insert into messaging_auth_users(phone,display_name) values($1,'Owner') returning id", [phone])).rows[0].id;
      for (const tenant of tenants) await client.query("insert into messaging_auth_user_businesses(user_id,messaging_business_id) values($1,$2)", [user, tenant]);
    };
    const both = "+919800000001", onlyB = "+919800000002", stranger = "+919800000003";
    await addUser(both, [tenantA, tenantB]);
    await addUser(onlyB, [tenantB]);

    const service = await import("../lib/admin/phone-login-service.ts");
    const { WhatsAppOtpUnavailableError } = await import("../lib/auth/whatsapp-otp.ts");
    const sent = [];
    const sender = async businessId => ({ businessId, phoneNumberId: `pn-${businessId}`, template: { name: "login_code", language: "en" } });
    const deliver = async (from, phone, code) => { sent.push({ businessId: from.businessId, phoneNumberId: from.phoneNumberId, phone, code }); };
    const deps = { pool, sender, deliver };
    console.error = console.log = console.info = console.warn = (...args) => logs.push(args.map(String).join(" "));
    const rejects = async (promise, code) => assert.rejects(promise, error => error instanceof service.PhoneLoginError && error.code === code, code);
    const lastCode = (businessId, phone) => [...sent].reverse().find(entry => entry.businessId === businessId && entry.phone === phone)?.code;
    const age = (tenant, phone, seconds) => client.query("update messaging_phone_login_challenges set created_at=created_at - make_interval(secs => $3) where messaging_business_id=$1 and phone=$2", [tenant, phone, seconds]);

    // Sent from the business's own number; stored only as an HMAC; expires in 5 minutes.
    const requestedFrom = Date.now();
    await service.requestBusinessLoginOtp("otp-shop-a", both, "203.0.113.9", deps);
    const requestedTo = Date.now();
    assert.equal(sent.length, 1);
    assert.deepEqual({ ...sent[0], code: undefined }, { businessId: "otp-shop-a", phoneNumberId: "pn-otp-shop-a", phone: both, code: undefined });
    const codeA = lastCode("otp-shop-a", both);
    assert.match(codeA, /^\d{6}$/);
    const stored = (await client.query("select * from messaging_phone_login_challenges where messaging_business_id=$1", [tenantA])).rows;
    assert.equal(stored.length, 1);
    assert.ok(!JSON.stringify(stored).includes(codeA), "the code is never stored in plain text");
    assert.match(stored[0].code_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(stored[0].ip_hash, "203.0.113.9", "the client address is hashed");
    const expiresAt = new Date(stored[0].expires_at).getTime();
    assert.ok(expiresAt >= requestedFrom + 5 * 60_000 && expiresAt <= requestedTo + 5 * 60_000, "expires 5 minutes after the request");

    // Resend cooldown.
    await assert.rejects(service.requestBusinessLoginOtp("otp-shop-a", both, "203.0.113.9", deps),
      error => error.code === "RESEND_COOLDOWN" && error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 60);
    assert.equal(sent.length, 1, "no code is sent during the cooldown");

    // The same phone is a separate login in another business, sent from that business's own number.
    await service.requestBusinessLoginOtp("otp-shop-b", both, "203.0.113.9", deps);
    assert.equal(sent.at(-1).phoneNumberId, "pn-otp-shop-b");
    const codeB = lastCode("otp-shop-b", both);
    if (codeA !== codeB) await rejects(service.verifyBusinessLoginOtp("otp-shop-a", both, codeB, { pool }), "INVALID_OTP");
    pass("PASS code sent from the business's own number; HMAC-only storage; 5-minute expiry; resend cooldown; the same phone is separate per business");

    // Verify: a session for this one business, locked to it.
    const signedIn = await service.verifyBusinessLoginOtp("otp-shop-a", both, codeA, { pool });
    assert.equal(signedIn.businessId, "otp-shop-a");
    assert.match(signedIn.token, /^otp_/);
    const session = (await client.query("select * from messaging_phone_login_sessions")).rows;
    assert.equal(session.length, 1);
    assert.equal(session[0].selected_business_id, tenantA);
    assert.equal(session[0].tenant_locked, true);
    assert.ok(!JSON.stringify(session).includes(signedIn.token), "only the session token's hash is stored");
    assert.deepEqual(await service.resolvePhoneLoginSession(signedIn.token, pool), { role: "business", businessId: "otp-shop-a" });
    assert.deepEqual(await service.listPhoneLoginBusinesses(signedIn.token, pool), [{ id: "otp-shop-a", name: "Shop otp-shop-a" }], "a locked session sees only its business");
    await rejects(service.selectPhoneLoginBusiness(signedIn.token, "otp-shop-b", pool), "BUSINESS_FORBIDDEN");
    assert.deepEqual(await service.resolvePhoneLoginSession(signedIn.token, pool), { role: "business", businessId: "otp-shop-a" }, "still locked to its business");
    await rejects(service.verifyBusinessLoginOtp("otp-shop-a", both, codeA, { pool }), "OTP_EXPIRED");
    // Shop B's pending code is untouched by signing in to shop A.
    const signedInB = await service.verifyBusinessLoginOtp("otp-shop-b", both, codeB, { pool });
    assert.deepEqual(await service.resolvePhoneLoginSession(signedInB.token, pool), { role: "business", businessId: "otp-shop-b" });
    pass("PASS verify creates a business-scoped session for businessId + phone, locked to that business; a code is single-use");

    // Attempt limit.
    await service.requestBusinessLoginOtp("otp-shop-b", onlyB, "203.0.113.10", deps);
    const codeOnly = lastCode("otp-shop-b", onlyB);
    const wrong = codeOnly === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt < 5; attempt++) await rejects(service.verifyBusinessLoginOtp("otp-shop-b", onlyB, wrong, { pool }), "INVALID_OTP");
    await rejects(service.verifyBusinessLoginOtp("otp-shop-b", onlyB, wrong, { pool }), "RATE_LIMITED");
    await rejects(service.verifyBusinessLoginOtp("otp-shop-b", onlyB, codeOnly, { pool }), "OTP_EXPIRED");
    // Expiry, and a new code after the cooldown replaces the old one.
    await age(tenantB, onlyB, 120);
    await service.requestBusinessLoginOtp("otp-shop-b", onlyB, "203.0.113.10", deps);
    const fresh = lastCode("otp-shop-b", onlyB);
    await client.query("update messaging_phone_login_challenges set expires_at=now() - interval '1 second' where messaging_business_id=$1 and phone=$2 and consumed_at is null", [tenantB, onlyB]);
    await rejects(service.verifyBusinessLoginOtp("otp-shop-b", onlyB, fresh, { pool }), "OTP_EXPIRED");
    // Hourly limit per business + phone (5 an hour).
    for (let n = 0; n < 3; n++) { await age(tenantB, onlyB, 120); await service.requestBusinessLoginOtp("otp-shop-b", onlyB, `203.0.113.${20 + n}`, deps); }
    await age(tenantB, onlyB, 120);
    await rejects(service.requestBusinessLoginOtp("otp-shop-b", onlyB, "203.0.113.30", deps), "RATE_LIMITED");
    pass("PASS 5 wrong attempts lock the code; expired codes fail; 5 codes an hour per business + phone");

    // Not a member: same response, nothing sent, and no way to sign in.
    const before = sent.length;
    await service.requestBusinessLoginOtp("otp-shop-a", stranger, "203.0.113.40", deps);
    await service.requestBusinessLoginOtp("otp-shop-a", onlyB, "203.0.113.41", deps);
    assert.equal(sent.length, before, "no code goes to a phone that is not a member of this business");
    await rejects(service.verifyBusinessLoginOtp("otp-shop-a", onlyB, "123456", { pool }), "INVALID_OTP");
    // Business not available for WhatsApp sign-in.
    for (const reason of ["BUSINESS_INACTIVE", "NOT_CONNECTED", "NO_AUTH_TEMPLATE"])
      await rejects(service.requestBusinessLoginOtp("otp-shop-a", both, "203.0.113.50", { pool, deliver, sender: async () => { throw new WhatsAppOtpUnavailableError(reason); } }), "WHATSAPP_UNAVAILABLE");
    await rejects(service.requestBusinessLoginOtp("otp-shop-off", both, "203.0.113.51", deps), "WHATSAPP_UNAVAILABLE");
    await rejects(service.requestBusinessLoginOtp("otp-shop-a", both, "203.0.113.52", { pool, deliver, sender: async () => ({ businessId: "otp-shop-b", phoneNumberId: "pn-b", template: { name: "x", language: "en" } }) }), "WHATSAPP_UNAVAILABLE");
    await rejects(service.requestBusinessLoginOtp("Not A Business", both, "203.0.113.53", deps), "WHATSAPP_UNAVAILABLE");
    // Meta failure: the code is withdrawn.
    await age(tenantA, both, 120);
    await rejects(service.requestBusinessLoginOtp("otp-shop-a", both, "203.0.113.54", { pool, sender, deliver: async () => { throw new Error("meta down"); } }), "DELIVERY_UNAVAILABLE");
    const withdrawn = (await client.query("select consumed_at from messaging_phone_login_challenges where messaging_business_id=$1 and phone=$2 order by created_at desc limit 1", [tenantA, both])).rows[0];
    assert.ok(withdrawn.consumed_at, "an undelivered code cannot be used");
    pass("PASS non-members are sent nothing; no WhatsApp/auth template or inactive business means no code; a failed send withdraws the code");

    for (const { code } of sent) assert.ok(!logs.some(line => line.includes(code)), "no code appears in any log");
  } finally {
    console.error = originalError; console.log = originalLog; console.info = originalInfo; console.warn = originalWarn;
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }

  // 3. Wiring: SMS sign-in only touches SMS challenges; routes; Super Admin untouched.
  const service = fs.readFileSync("lib/admin/phone-login-service.ts", "utf8");
  const sms = service.slice(service.indexOf("export async function requestPhoneLoginOtp"), service.indexOf("export async function resolvePhoneLoginSession"));
  assert.equal((sms.match(/messaging_business_id is null/g) ?? []).length, 3, "SMS limits, replacement and verification ignore WhatsApp challenges");
  const otp = fs.readFileSync("lib/auth/whatsapp-otp.ts", "utf8");
  assert.match(otp, /await sendingAccessToken\(sender\.phoneNumberId\)/, "sent with the business's own token");
  assert.doesNotMatch(otp + service, /console\.\w+\([^)]*[^.\w]code\b/, "no log statement includes the sign-in code");
  assert.doesNotMatch(otp, /META_ACCESS_TOKEN|TWILIO/, "no central number or token");
  const request = fs.readFileSync("app/api/auth/phone/request/route.ts", "utf8");
  assert.match(request, /if \(body\.businessId\) await requestBusinessLoginOtp\(body\.businessId, body\.phone, clientAddress\);\s*else await requestPhoneLoginOtp/);
  const verify = fs.readFileSync("app/api/auth/phone/verify/route.ts", "utf8");
  assert.match(verify, /verifyBusinessLoginOtp\(body\.businessId, body\.phone, body\.code\)/);
  assert.match(verify, /response\.cookies\.set\(dashboardSessionCookieName, result\.token/, "same signed dashboard session cookie");
  assert.match(fs.readFileSync("app/admin/components/dashboard-access-required.tsx", "utf8"), /\/login\?business=\$\{encodeURIComponent\(businessId\)\}/);
  for (const file of ["lib/admin/super-admin-session.ts", "lib/admin/directory-session.ts", "lib/admin/staging-admin-bootstrap.ts"])
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /phone-login|whatsapp-otp/, `${file}: Super Admin auth is unchanged`);
  const migration = fs.readFileSync("drizzle-postgres/0010_whatsapp_otp_login.sql", "utf8");
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)|DELETE\s+FROM|TRUNCATE|ALTER\s+COLUMN|UPDATE\s+"/i, "the migration only adds");
  console.log("PASS SMS sign-in is unchanged and separate; routes use WhatsApp when a business is given; same session cookie; Super Admin auth untouched; additive migration");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
