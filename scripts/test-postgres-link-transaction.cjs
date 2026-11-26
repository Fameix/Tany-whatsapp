/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { randomBytes, randomUUID } = require("node:crypto");

async function main() {
  loadEnvConfig(process.cwd());
  const raw=process.env.DATABASE_URL;
  assert.equal(process.env.MESSAGING_POSTGRES_TARGET,"staging","requires explicit staging target");
  assert.ok(raw,"DATABASE_URL required");
  const u=new URL(raw); assert.doesNotMatch(`${u.hostname}${u.pathname}`,/prod|production|live/i,"production target forbidden");
  const client=new Client({connectionString:raw}); await client.connect();
  const migration=await client.query("select to_regclass('public.whatsapp_link_sessions') s, to_regclass('public.whatsapp_identities') i, to_regclass('public.whatsapp_customer_links') c");
  assert.ok(migration.rows[0].s&&migration.rows[0].i&&migration.rows[0].c,"Phase 5A schema must exist in staging");
  const business="demo-retail"; const businessRow=await client.query("select status from messaging_businesses where legacy_business_id=$1",[business]); assert.equal(businessRow.rowCount,1); assert.equal(businessRow.rows[0].status,"active");
  const suffix=randomBytes(6).toString("hex"); const phone=`919${suffix}`; const uid=`phase5a-${randomUUID()}`; const token=randomBytes(32).toString("hex");
  const { PostgresMessagingRepository }=await import("../lib/data/postgres-messaging-repository.ts");
  const repo=new PostgresMessagingRepository();
  const insert=async(t=token,p=phone,expires="now()+interval '5 minutes'")=>client.query(`insert into whatsapp_link_sessions(token,whatsapp_phone,legacy_business_id,expires_at,used) values($1,$2,$3,${expires},false)`,[t,p,business]);
  let triggerName=null;
  try {
    await insert();
    assert.deepEqual(await repo.completeLinkSession(token,uid),{businessId:business,whatsappPhone:phone});
    assert.equal((await repo.identity(phone)).uid,uid); assert.equal((await repo.pendingIntent(business,phone)),null); assert.equal((await repo.getLinkSession(token)).used,true);
    console.log("PASS successful atomic link completion");
    assert.equal(await repo.completeLinkSession(token,uid),null); console.log("PASS duplicate/retry completion idempotent");
    const expired=randomBytes(32).toString("hex"), expPhone=`928${suffix}`; await insert(expired,expPhone,"now()-interval '1 second'"); assert.equal(await repo.completeLinkSession(expired,uid),null); console.log("PASS expired session rejected");
    const consumed=randomBytes(32).toString("hex"), conPhone=`927${suffix}`; await client.query("insert into whatsapp_link_sessions(token,whatsapp_phone,legacy_business_id,expires_at,used) values($1,$2,$3,now()+interval '5 minutes',true)",[consumed,conPhone,business]); assert.equal(await repo.completeLinkSession(consumed,uid),null); console.log("PASS consumed session rejected");
    const iso=randomBytes(32).toString("hex"), ip=`926${suffix}`; const other=await client.query("select legacy_business_id from messaging_businesses where legacy_business_id<>$1 limit 1",[business]);
    if(other.rowCount){await client.query("insert into whatsapp_link_sessions(token,whatsapp_phone,legacy_business_id,expires_at,used) values($1,$2,$3,now()+interval '5 minutes',false)",[iso,ip,other.rows[0].legacy_business_id]); assert.equal(await repo.completeLinkSession(iso,uid),null); assert.equal(await repo.identity(ip),null); console.log("PASS tenant isolation");}
    else { await insert(iso,ip); await client.query("update messaging_businesses set status='inactive' where legacy_business_id=$1",[business]); try { assert.equal(await repo.completeLinkSession(iso,uid),null); } finally { await client.query("update messaging_businesses set status='active' where legacy_business_id=$1",[business]); } assert.equal(await repo.identity(ip),null); console.log("PASS tenant isolation"); }
    // Force customer-link upsert failure after identity upsert; transaction must roll back both and keep session reusable.
    const failToken=randomBytes(32).toString("hex"), failPhone=`925${suffix}`; await insert(failToken,failPhone);
    triggerName=`phase5a_fail_${suffix}`;
    await client.query(`create function public.${triggerName}() returns trigger language plpgsql as $$ begin if new.whatsapp_phone='${failPhone}' then raise exception 'test forced failure'; end if; return new; end $$`);
    await client.query(`create trigger ${triggerName} before insert or update on whatsapp_customer_links for each row execute function public.${triggerName}()`);
    await assert.rejects(()=>repo.completeLinkSession(failToken,uid));
    assert.equal(await repo.identity(failPhone),null); assert.equal((await repo.getLinkSession(failToken)).used,false); console.log("PASS rollback on customer-link write failure");
  } finally {
    if(triggerName){await client.query(`drop trigger if exists ${triggerName} on whatsapp_customer_links`);await client.query(`drop function if exists public.${triggerName}()`)}
    await client.query("delete from whatsapp_customer_links where legacy_business_id=$1 and whatsapp_phone like $2",[business,`%${suffix}`]);
    await client.query("delete from whatsapp_identities where phone like $1",[`%${suffix}`]);
    await client.query("delete from whatsapp_link_sessions where token=$1 or whatsapp_phone like $2",[token,`%${suffix}`]);
    await client.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1});
