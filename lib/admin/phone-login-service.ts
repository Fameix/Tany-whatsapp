import "server-only";
import { createHash, createHmac, randomInt, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { purchasedWorkspaceProducts } from "./workspace-products";
import { postgresTransactionPool } from "@/lib/data/postgres-client";
import { deliverWhatsAppOtp, whatsappOtpSender, WhatsAppOtpUnavailableError, type WhatsAppOtpSender } from "@/lib/auth/whatsapp-otp";
import { resendWaitSeconds, whatsappOtpTtlMs } from "@/lib/auth/whatsapp-otp-model";

const otpTtlMs = 5 * 60_000;
const maxAttempts = 5;
const phoneHourLimit = 5;
const ipHourLimit = 20;
const sessionTtlMs = 8 * 60 * 60_000;
const phonePattern = /^\+[1-9]\d{7,14}$/;
const text = (value: unknown) => typeof value === "string" ? value : "";
type AuthResult<T = Record<string, unknown>> = { rows: T[]; rowCount: number | null };
type AuthClient = { query(statement: string, values?: unknown[]): Promise<unknown>; release(): void };
/** The Postgres pool sign-in uses; tests pass a single connection whose temporary tables stand in for staging's. */
export type AuthPool = { connect(): Promise<AuthClient> };
const defaultPool = (): AuthPool => postgresTransactionPool() as unknown as AuthPool;
async function poolQuery<T = Record<string, unknown>>(statement: string, values: Array<string | number | null> = [], pool = defaultPool()): Promise<AuthResult<T>> {
  const client = await pool.connect();
  try { return await client.query(statement, values) as unknown as AuthResult<T>; }
  finally { client.release(); }
}
const secret = () => {
  const value = process.env.TANY_PHONE_LOGIN_SECRET ?? "";
  if (value.length < 32) throw new Error("Phone login secret is not configured.");
  return value;
};
const otpHash = (id: string, code: string) => createHmac("sha256", secret()).update(`${id}:${code}`).digest("hex");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class PhoneLoginError extends Error {
  constructor(public code: "INVALID_PHONE" | "RATE_LIMITED" | "RESEND_COOLDOWN" | "DELIVERY_UNAVAILABLE" | "WHATSAPP_UNAVAILABLE" | "INVALID_OTP" | "OTP_EXPIRED" | "ACCOUNT_UNAVAILABLE" | "INVALID_SESSION" | "BUSINESS_FORBIDDEN", public status: number, public retryAfterSeconds = 0) {
    super(code);
  }
}

async function deliverOtp(phone: string, code: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const auth = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_PHONE_NUMBER ?? "";
  if (!/^AC[a-fA-F0-9]{32}$/.test(sid) || auth.length < 16 || !/^\+[1-9]\d{7,14}$/.test(from)) throw new PhoneLoginError("DELIVERY_UNAVAILABLE", 503);
  const body = new URLSearchParams({ To: phone, From: from, Body: `Your Tany Messaging verification code is ${code}. It expires in 5 minutes.` });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new PhoneLoginError("DELIVERY_UNAVAILABLE", 503);
}

export async function requestPhoneLoginOtp(phone: string, clientAddress: string) {
  if (!phonePattern.test(phone)) throw new PhoneLoginError("INVALID_PHONE", 400);
  const clientHash = createHmac("sha256", secret()).update((clientAddress || "unknown").slice(0, 128)).digest("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const pool = postgresTransactionPool();
  const client = await pool.connect();
  let challengeId = "";
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(0, hashtext($1))", [phone]);
    await client.query("select pg_advisory_xact_lock(1, hashtext($1))", [clientHash]);
    const counts = await client.query("select count(*) filter (where phone=$1 and messaging_business_id is null)::int as phone_count, count(*) filter (where ip_hash=$2)::int as ip_count from messaging_phone_login_challenges where created_at > now() - interval '1 hour'", [phone, clientHash]) as unknown as AuthResult<{ phone_count: number; ip_count: number }>;
    if (counts.rows[0].phone_count >= phoneHourLimit || counts.rows[0].ip_count >= ipHourLimit) throw new PhoneLoginError("RATE_LIMITED", 429);
    await client.query("update messaging_phone_login_challenges set consumed_at=coalesce(consumed_at,now()) where phone=$1 and messaging_business_id is null and consumed_at is null", [phone]);
    challengeId = randomUUID();
    await client.query("insert into messaging_phone_login_challenges(id,phone,ip_hash,code_hash,expires_at) values($1,$2,$3,$4,$5)", [challengeId, phone, clientHash, otpHash(challengeId, code), new Date(Date.now() + otpTtlMs).toISOString()]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
  try { await deliverOtp(phone, code); }
  catch (error) {
    await poolQuery("update messaging_phone_login_challenges set consumed_at=coalesce(consumed_at,now()) where id=$1", [challengeId]);
    throw error;
  }
}

export async function verifyPhoneLoginOtp(phone: string, code: string) {
  if (!phonePattern.test(phone) || !/^\d{6}$/.test(code)) throw new PhoneLoginError("INVALID_OTP", 401);
  const pool = postgresTransactionPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query("select id,code_hash,expires_at,attempts,consumed_at from messaging_phone_login_challenges where phone=$1 and messaging_business_id is null order by created_at desc limit 1 for update", [phone]) as unknown as AuthResult<{ id: string; code_hash: string; expires_at: Date | string; attempts: number; consumed_at: Date | null }>;
    const challenge = found.rows[0];
    if (!challenge || challenge.consumed_at) throw new PhoneLoginError("OTP_EXPIRED", 401);
    if (new Date(challenge.expires_at).getTime() <= Date.now()) {
      await client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
      throw new PhoneLoginError("OTP_EXPIRED", 401);
    }
    if (challenge.attempts >= maxAttempts) {
      await client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
      throw new PhoneLoginError("RATE_LIMITED", 429);
    }
    const expected = Buffer.from(text(challenge.code_hash), "hex");
    const actual = Buffer.from(otpHash(challenge.id, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = Number(challenge.attempts) + 1;
      await client.query("update messaging_phone_login_challenges set attempts=$2, consumed_at=$3 where id=$1", [challenge.id, attempts, attempts >= maxAttempts ? new Date().toISOString() : null]);
      await client.query("commit");
      throw new PhoneLoginError(attempts >= maxAttempts ? "RATE_LIMITED" : "INVALID_OTP", attempts >= maxAttempts ? 429 : 401);
    }
    const user = await client.query("select id from messaging_auth_users where phone=$1 and status='active' for update", [phone]) as unknown as AuthResult<{ id: string }>;
    if (!user.rowCount) {
      await client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
      await client.query("commit");
      throw new PhoneLoginError("ACCOUNT_UNAVAILABLE", 403);
    }
    const memberships = await client.query("select b.id,b.legacy_business_id,b.name,b.vertical,b.products from messaging_auth_user_businesses ub join messaging_businesses b on b.id=ub.messaging_business_id where ub.user_id=$1 and b.status='active' order by b.name,b.legacy_business_id", [user.rows[0].id]) as unknown as AuthResult<{ id: string; legacy_business_id: string; name: string; vertical: string; products: unknown }>;
    const eligible = memberships.rows.filter(business => purchasedWorkspaceProducts(business.vertical, business.products).length);
    if (!eligible.length) {
      await client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
      await client.query("commit");
      throw new PhoneLoginError("ACCOUNT_UNAVAILABLE", 403);
    }
    const token = `otp_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hash(token);
    const singleBusiness = eligible.length === 1 ? eligible[0].id : null;
    await client.query("insert into messaging_phone_login_sessions(token_hash,user_id,selected_business_id,expires_at) values($1,$2,$3,$4)", [tokenHash, user.rows[0].id, singleBusiness, new Date(Date.now() + sessionTtlMs).toISOString()]);
    await client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
    await client.query("commit");
    return {
      token,
      businesses: eligible.map(row => ({ id: text(row.legacy_business_id), name: text(row.name) })),
      selectedBusinessId: singleBusiness ? text(eligible[0].legacy_business_id) : null,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function resolvePhoneLoginSession(token: string, pool = defaultPool()) {
  if (!token.startsWith("otp_") || token.length > 100) return null;
  const result = await poolQuery<{ user_id: string; status: string; expires_at: Date; legacy_business_id: string | null; businesses: string[] }>("select u.id as user_id, u.status, s.expires_at, b.legacy_business_id, array(select b2.legacy_business_id from messaging_auth_user_businesses ub2 join messaging_businesses b2 on b2.id=ub2.messaging_business_id where ub2.user_id=u.id and b2.status='active' order by b2.name) as businesses from messaging_phone_login_sessions s join messaging_auth_users u on u.id=s.user_id left join messaging_businesses b on b.id=s.selected_business_id and b.status='active' where s.token_hash=$1 and s.expires_at > now() and (s.selected_business_id is null or (b.id is not null and exists(select 1 from messaging_auth_user_businesses ub where ub.user_id=u.id and ub.messaging_business_id=b.id)))", [hash(token)], pool);
  const row = result.rows[0];
  if (!row || row.status !== "active") return null;
  await poolQuery("update messaging_phone_login_sessions set last_seen_at=now() where token_hash=$1", [hash(token)], pool);
  const businessIds = row.businesses as string[];
  return row.legacy_business_id
    ? { role: "business" as const, businessId: text(row.legacy_business_id) }
    : { role: "selector" as const, businessIds };
}

export async function selectPhoneLoginBusiness(token: string, businessId: string, pool = defaultPool()) {
  if (!token.startsWith("otp_") || !businessId) throw new PhoneLoginError("INVALID_SESSION", 401);
  if (!(await listPhoneLoginBusinesses(token, pool)).some(business => business.id === businessId))
    throw new PhoneLoginError("BUSINESS_FORBIDDEN", 403);
  const result = await poolQuery("update messaging_phone_login_sessions s set selected_business_id=b.id,last_seen_at=now() from messaging_businesses b join messaging_auth_user_businesses ub on ub.messaging_business_id=b.id where s.token_hash=$1 and s.user_id=ub.user_id and s.expires_at > now() and b.legacy_business_id=$2 and b.status='active' and (not s.tenant_locked or s.selected_business_id=b.id) returning b.legacy_business_id", [hash(token), businessId], pool);
  if (!result.rowCount) throw new PhoneLoginError("BUSINESS_FORBIDDEN", 403);
}

export async function listPhoneLoginBusinesses(token: string, pool = defaultPool()) {
  if (!token.startsWith("otp_") || token.length > 100) throw new PhoneLoginError("INVALID_SESSION", 401);
  const result = await poolQuery<{ id: string; name: string; vertical: string; products: unknown }>("select b.legacy_business_id as id,b.name,b.vertical,b.products from messaging_phone_login_sessions s join messaging_auth_users u on u.id=s.user_id join messaging_auth_user_businesses ub on ub.user_id=u.id join messaging_businesses b on b.id=ub.messaging_business_id where s.token_hash=$1 and s.expires_at > now() and u.status='active' and b.status='active' and (not s.tenant_locked or b.id=s.selected_business_id) order by b.name,b.legacy_business_id", [hash(token)], pool);
  if (!result.rowCount) throw new PhoneLoginError("INVALID_SESSION", 401);
  return result.rows.filter(row => purchasedWorkspaceProducts(row.vertical, row.products).length)
    .map(row => ({ id: text(row.id), name: text(row.name) }));
}

export async function revokePhoneLoginSession(token: string, pool = defaultPool()) {
  if (token.startsWith("otp_")) await poolQuery("delete from messaging_phone_login_sessions where token_hash=$1", [hash(token)], pool);
}

/* WhatsApp OTP sign-in for one business. The code is sent from that business's own connected
 * WhatsApp number with its approved Authentication template (lib/auth/whatsapp-otp). A phone is a
 * separate login in each business: challenges, limits and sessions are keyed by business + phone,
 * and the session is locked to that business. Only the code's HMAC is stored. */

export type BusinessLoginDeps = {
  pool?: AuthPool;
  sender?: (businessId: string) => Promise<WhatsAppOtpSender>;
  deliver?: (sender: WhatsAppOtpSender, phone: string, code: string) => Promise<void>;
};
const businessIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const businessOtpHash = (id: string, tenant: string, code: string) => createHmac("sha256", secret()).update(`whatsapp:${id}:${tenant}:${code}`).digest("hex");

export async function requestBusinessLoginOtp(businessId: string, phone: string, clientAddress: string, deps: BusinessLoginDeps = {}) {
  if (!phonePattern.test(phone)) throw new PhoneLoginError("INVALID_PHONE", 400);
  if (!businessIdPattern.test(businessId) || businessId.length > 80) throw new PhoneLoginError("WHATSAPP_UNAVAILABLE", 503);
  const sender = await (deps.sender ?? whatsappOtpSender)(businessId).catch((error: unknown) => {
    if (error instanceof WhatsAppOtpUnavailableError) throw new PhoneLoginError("WHATSAPP_UNAVAILABLE", 503);
    throw error;
  });
  if (sender.businessId !== businessId) throw new PhoneLoginError("WHATSAPP_UNAVAILABLE", 503);
  const clientHash = createHmac("sha256", secret()).update((clientAddress || "unknown").slice(0, 128)).digest("hex");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const client = await (deps.pool ?? defaultPool()).connect();
  let challengeId = "";
  let member = false;
  try {
    await client.query("begin");
    const tenant = await client.query("select id from messaging_businesses where legacy_business_id=$1 and status='active'", [businessId]) as AuthResult<{ id: string }>;
    if (tenant.rows.length !== 1) throw new PhoneLoginError("WHATSAPP_UNAVAILABLE", 503);
    const tenantId = tenant.rows[0].id;
    await client.query("select pg_advisory_xact_lock(2, hashtext($1))", [`${tenantId}:${phone}`]);
    await client.query("select pg_advisory_xact_lock(1, hashtext($1))", [clientHash]);
    const last = await client.query("select created_at from messaging_phone_login_challenges where messaging_business_id=$1 and phone=$2 order by created_at desc limit 1", [tenantId, phone]) as AuthResult<{ created_at: Date | string }>;
    const wait = resendWaitSeconds(last.rows[0]?.created_at);
    if (wait) throw new PhoneLoginError("RESEND_COOLDOWN", 429, wait);
    const counts = await client.query("select count(*) filter (where messaging_business_id=$1 and phone=$2)::int as phone_count, count(*) filter (where ip_hash=$3)::int as ip_count from messaging_phone_login_challenges where created_at > now() - interval '1 hour'", [tenantId, phone, clientHash]) as AuthResult<{ phone_count: number; ip_count: number }>;
    if (counts.rows[0].phone_count >= phoneHourLimit || counts.rows[0].ip_count >= ipHourLimit) throw new PhoneLoginError("RATE_LIMITED", 429);
    // Only a member of this business is sent a code; everyone else gets the same response.
    const membership = await client.query("select 1 from messaging_auth_users u join messaging_auth_user_businesses ub on ub.user_id=u.id where u.phone=$1 and u.status='active' and ub.messaging_business_id=$2", [phone, tenantId]) as AuthResult;
    member = !!membership.rowCount;
    await client.query("update messaging_phone_login_challenges set consumed_at=coalesce(consumed_at,now()) where messaging_business_id=$1 and phone=$2 and consumed_at is null", [tenantId, phone]);
    challengeId = randomUUID();
    await client.query("insert into messaging_phone_login_challenges(id,phone,messaging_business_id,ip_hash,code_hash,expires_at) values($1,$2,$3,$4,$5,$6)", [challengeId, phone, tenantId, clientHash, businessOtpHash(challengeId, tenantId, code), new Date(Date.now() + whatsappOtpTtlMs).toISOString()]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  if (!member) return;
  try { await (deps.deliver ?? deliverWhatsAppOtp)(sender, phone, code); }
  catch {
    await poolQuery("update messaging_phone_login_challenges set consumed_at=coalesce(consumed_at,now()) where id=$1", [challengeId], deps.pool);
    throw new PhoneLoginError("DELIVERY_UNAVAILABLE", 503);
  }
}

export async function verifyBusinessLoginOtp(businessId: string, phone: string, code: string, deps: Pick<BusinessLoginDeps, "pool"> = {}) {
  if (!businessIdPattern.test(businessId) || !phonePattern.test(phone) || !/^\d{6}$/.test(code)) throw new PhoneLoginError("INVALID_OTP", 401);
  const client = await (deps.pool ?? defaultPool()).connect();
  try {
    await client.query("begin");
    const tenant = await client.query("select id,legacy_business_id,vertical,products from messaging_businesses where legacy_business_id=$1 and status='active'", [businessId]) as AuthResult<{ id: string; legacy_business_id: string; vertical: string; products: unknown }>;
    if (tenant.rows.length !== 1) throw new PhoneLoginError("OTP_EXPIRED", 401);
    const tenantId = tenant.rows[0].id;
    const found = await client.query("select id,code_hash,expires_at,attempts,consumed_at from messaging_phone_login_challenges where messaging_business_id=$1 and phone=$2 order by created_at desc limit 1 for update", [tenantId, phone]) as AuthResult<{ id: string; code_hash: string; expires_at: Date | string; attempts: number; consumed_at: Date | null }>;
    const challenge = found.rows[0];
    if (!challenge || challenge.consumed_at) throw new PhoneLoginError("OTP_EXPIRED", 401);
    const consume = () => client.query("update messaging_phone_login_challenges set consumed_at=now() where id=$1", [challenge.id]);
    if (new Date(challenge.expires_at).getTime() <= Date.now()) { await consume(); await client.query("commit"); throw new PhoneLoginError("OTP_EXPIRED", 401); }
    if (challenge.attempts >= maxAttempts) { await consume(); await client.query("commit"); throw new PhoneLoginError("RATE_LIMITED", 429); }
    const expected = Buffer.from(text(challenge.code_hash), "hex");
    const actual = Buffer.from(businessOtpHash(challenge.id, tenantId, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const attempts = Number(challenge.attempts) + 1;
      await client.query("update messaging_phone_login_challenges set attempts=$2, consumed_at=$3 where id=$1", [challenge.id, attempts, attempts >= maxAttempts ? new Date().toISOString() : null]);
      await client.query("commit");
      throw new PhoneLoginError(attempts >= maxAttempts ? "RATE_LIMITED" : "INVALID_OTP", attempts >= maxAttempts ? 429 : 401);
    }
    const user = await client.query("select u.id from messaging_auth_users u join messaging_auth_user_businesses ub on ub.user_id=u.id where u.phone=$1 and u.status='active' and ub.messaging_business_id=$2 for update of u", [phone, tenantId]) as AuthResult<{ id: string }>;
    if (!user.rowCount || !purchasedWorkspaceProducts(tenant.rows[0].vertical, tenant.rows[0].products).length) {
      await consume(); await client.query("commit");
      throw new PhoneLoginError("ACCOUNT_UNAVAILABLE", 403);
    }
    const token = `otp_${randomBytes(32).toString("base64url")}`;
    await client.query("insert into messaging_phone_login_sessions(token_hash,user_id,selected_business_id,tenant_locked,expires_at) values($1,$2,$3,true,$4)", [hash(token), user.rows[0].id, tenantId, new Date(Date.now() + sessionTtlMs).toISOString()]);
    await consume();
    await client.query("commit");
    return { token, businessId: text(tenant.rows[0].legacy_business_id) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** The name the sign-in page shows for a business login link, or null for an unknown/inactive business. */
export async function businessLoginName(businessId: string, pool = defaultPool()) {
  if (!businessIdPattern.test(businessId) || businessId.length > 80) return null;
  const result = await poolQuery<{ name: string }>("select name from messaging_businesses where legacy_business_id=$1 and status='active'", [businessId], pool);
  return result.rows.length === 1 ? text(result.rows[0].name) : null;
}
