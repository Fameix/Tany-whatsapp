import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";
import { activeTanyVerticals, type ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { listProductTenants, type ProductReader } from "./product-scope";
import { postgresWhatsAppStatus } from "./postgres-whatsapp-status";
import { startOfTodayIst } from "./product-center";
import type { ProductBusiness } from "./product-center";

const dayMs = 86_400_000;

export type OverviewMetrics = {
  businesses: number;
  connected: number;
  conversations: number;
  sent: number;
  automations: number;
  campaigns: number;
  customers: number;
};

export type OverviewDay = {
  date: string;
  conversations: number;
  incoming: number;
  outgoing: number;
};

export type MessagingHealth = {
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  sent: number;
  unknown: number;
  total: number;
};

export type OperationalOverview = {
  metrics: OverviewMetrics;
  breakdown: { product: ActiveTanyVertical; metrics: OverviewMetrics }[];
  days: OverviewDay[];
  health: MessagingHealth;
  attention: { id: string; name: string; disconnected: boolean; setup: boolean; failures: number; webhookFailures: number }[];
  activity: { id: string; name: string; event: string; at: string }[];
  directory: Pick<ProductBusiness, "id" | "name" | "product" | "kind" | "active" | "whatsapp" | "createdAt" | "lastActivity">[];
  productActivity: { recorded: number; completed: number } | null;
};

const zero = (): OverviewMetrics => ({ businesses: 0, connected: 0, conversations: 0, sent: 0, automations: 0, campaigns: 0, customers: 0 });

export async function getOperationalOverview(product: ActiveTanyVertical | null, {
  now = Date.now(), db = postgresDb(), includeTestData = false,
}: { now?: number; db?: ProductReader; includeTestData?: boolean } = {}): Promise<OperationalOverview> {
  const today = startOfTodayIst(now);
  const week = new Date(today.getTime() - 6 * dayMs);
  const end = new Date(now);
  const columns = product ? [product] : activeTanyVerticals;
  const productFilter = sql.join(columns.map(value => sql`${value}`), sql`, `);
  const tenants = (await listProductTenants(columns, db, product !== null && includeTestData)).map(({ id, kind }) => ({ id, kind }));
  const productActivity = product ? sql`(
    select jsonb_build_object('recorded', count(*), 'completed', count(*) filter (
      where r.data->>'status' = ${product === "motos" ? "completed" : "delivered"}
    ))
    from messaging_runtime_records r join scope b on b.id = r.messaging_business_id
    where ${product === "motos"
      ? sql`r.collection = 'bookings' and r.data->>'serviceId' = 'test_drive'`
      : sql`r.collection = 'orders'`}
  )` : sql`null`;
  const payload = await db.execute<{ overview: Omit<OperationalOverview, "metrics" | "breakdown"> & {
    breakdown: Partial<Record<ActiveTanyVertical, OverviewMetrics>>;
  } }>(sql`
    with scope as (
      select b.id, b.legacy_business_id, b.name, b.vertical, b.status, b.created_at, tenant.kind
      from messaging_businesses b
      join jsonb_to_recordset(${JSON.stringify(tenants)}::jsonb) tenant(id uuid, kind text) on b.id = tenant.id
      where b.vertical in (${productFilter})
    ), native_messages as (
      select m.messaging_business_id as tenant, m.meta_message_id as message_id, m.direction,
        coalesce(m.provider_timestamp, m.created_at) as at,
        coalesce(nullif(m.payload->>'conversationId', ''), c.legacy_contact_id, m.conversation_id::text) as conversation,
        coalesce(nullif(m.delivery_status, 'unknown'), m.payload->>'deliveryStatus', 'unknown') as status,
        m.processing_status
      from whatsapp_messages m join scope b on b.id = m.messaging_business_id
      left join whatsapp_conversations c on c.id = m.conversation_id and c.messaging_business_id = b.id
      where coalesce(m.provider_timestamp, m.created_at) between ${week} and ${end}
    ), runtime_messages as (
      select distinct on (r.messaging_business_id, coalesce(nullif(r.data->>'messageId', ''), r.legacy_id))
        r.messaging_business_id as tenant,
        coalesce(nullif(r.data->>'messageId', ''), r.legacy_id) as message_id,
        r.data->>'direction' as direction, r.created_at as at,
        nullif(r.data->>'conversationId', '') as conversation,
        coalesce(r.data->>'deliveryStatus', 'unknown') as status,
        r.data->>'processingStatus' as processing_status
      from messaging_runtime_records r join scope b on b.id = r.messaging_business_id
      where r.collection = 'messages' and r.created_at between ${week} and ${end}
        and not exists (
          select 1 from whatsapp_messages m where m.messaging_business_id = r.messaging_business_id
            and m.meta_message_id = coalesce(nullif(r.data->>'messageId', ''), r.legacy_id)
        )
      order by r.messaging_business_id, message_id, r.updated_at desc, r.legacy_id
    ), messages as (
      select * from native_messages
      union all
      select * from runtime_messages
    ), receipts as (
      select e.messaging_business_id as tenant, e.meta_message_id as message_id,
        bool_or(e.status = 'read') as read, bool_or(e.status = 'delivered') as delivered,
        bool_or(e.status = 'failed') as failed, bool_or(e.status = 'sent') as sent
      from whatsapp_message_events e
      join messages m on m.tenant = e.messaging_business_id and m.message_id = e.meta_message_id
      where m.direction = 'outgoing'
      group by e.messaging_business_id, e.meta_message_id
    ), delivery as (
      select m.*,
        case
          when m.status = 'read' or receipt.read then 'read'
          when m.status = 'delivered' or receipt.delivered then 'delivered'
          when m.status = 'failed' or receipt.failed or m.processing_status = 'failed' then 'failed'
          when m.status = 'sent' or receipt.sent then 'sent'
          when m.status in ('pending', 'sending', 'queued') then 'pending'
          else 'unknown'
        end as outcome
      from messages m
      left join receipts receipt using (tenant, message_id)
      where m.direction = 'outgoing'
    ), activity_days as (
      select tenant, conversation, ((at at time zone 'Asia/Kolkata')::date) as day
      from messages where conversation is not null
      union
      select b.id, coalesce(c.legacy_contact_id, c.id::text), (touch.at at time zone 'Asia/Kolkata')::date
      from whatsapp_conversations c join scope b on b.id = c.messaging_business_id
      cross join lateral (values (c.created_at), (c.last_incoming_at), (c.last_outgoing_at)) touch(at)
      where touch.at between ${week} and ${end}
    ), business_metrics as (
      select b.*,
        (wa.status = 'Connected') as connected,
        (wa.status in ('Disconnected', 'Error')) as disconnected,
        (wa.status = 'Configured · unverified') as configured,
        (select count(*)::int from activity_days d where d.tenant = b.id and d.day = (${today}::timestamptz at time zone 'Asia/Kolkata')::date) as conversations,
        (select count(*)::int from delivery d where d.tenant = b.id and d.at >= ${today} and d.outcome in ('sent', 'delivered', 'read')) as sent,
        (select count(*)::int from automation_definitions au where au.messaging_business_id = b.id and au.product = b.vertical and au.status = 'active') as automations,
        (select count(*)::int from messaging_runtime_records r where r.messaging_business_id = b.id and r.collection = 'campaigns' and r.data->>'status' in ('running', 'sending')) as campaigns,
        ${product ? sql`(select count(*)::int from whatsapp_contacts c where c.messaging_business_id = b.id)` : sql`0`} as customers,
        (select count(*)::int from delivery d where d.tenant = b.id and d.at >= ${today} and d.outcome = 'failed') as failures,
        (select count(*)::int from whatsapp_webhook_events w where w.messaging_business_id = b.id and w.processing_status = 'failed' and w.received_at >= ${today} and w.received_at <= ${end}) as webhook_failures
      from scope b left join whatsapp_accounts a on a.messaging_business_id = b.id
      cross join lateral (select ${postgresWhatsAppStatus} as status) wa
    ), product_metrics as (
      select vertical,
        jsonb_build_object('businesses', count(*) filter (where status = 'active'),
          'connected', count(*) filter (where connected and status = 'active'),
          'conversations', sum(conversations), 'sent', sum(sent),
          'automations', sum(automations), 'campaigns', sum(campaigns), 'customers', sum(customers)) as metrics
      from business_metrics group by vertical
    ), timeline as (
      select b.legacy_business_id as id, b.name, a.activated_at as at, 'WhatsApp connected' as event
      from whatsapp_accounts a join scope b on b.id = a.messaging_business_id
      where a.activated_at between ${week} and ${end}
      union all
      select b.legacy_business_id, b.name, a.updated_at, 'WhatsApp setup updated'
      from whatsapp_accounts a join scope b on b.id = a.messaging_business_id
      where a.status in ('pending', 'testing') and a.updated_at between ${week} and ${end}
      union all
      select b.legacy_business_id, b.name, t.updated_at,
        case when t.status = 'approved' then 'Approved template updated' else 'Rejected template updated' end
      from whatsapp_templates t join scope b on b.id = t.messaging_business_id
      where t.status in ('approved', 'rejected') and t.updated_at between ${week} and ${end}
      union all
      select b.legacy_business_id, b.name, r.started_at, 'Automation run started'
      from automation_runs r join scope b on b.id = r.messaging_business_id
      where r.started_at between ${week} and ${end}
      union all
      select b.legacy_business_id, b.name, r.updated_at, 'Campaign updated'
      from messaging_runtime_records r join scope b on b.id = r.messaging_business_id
      where r.collection = 'campaigns' and r.updated_at between ${week} and ${end}
    ), week_days as (
      select (${week}::timestamptz at time zone 'Asia/Kolkata')::date + offset_days as day
      from generate_series(0, 6) offset_days
    ), daily_conversations as (
      select day, count(*) as conversations from activity_days group by day
    ), daily_volume as (
      select (at at time zone 'Asia/Kolkata')::date as day,
        count(*) filter (where direction = 'incoming') as incoming,
        count(*) filter (where direction = 'outgoing') as outgoing
      from messages group by 1
    ), series as (
      select w.day as date, coalesce(c.conversations, 0) as conversations,
        coalesce(m.incoming, 0) as incoming, coalesce(m.outgoing, 0) as outgoing
      from week_days w left join daily_conversations c using (day) left join daily_volume m using (day)
    ), health as (
      select count(*) filter (where outcome = 'delivered') as delivered,
        count(*) filter (where outcome = 'read') as read,
        count(*) filter (where outcome = 'failed') as failed,
        count(*) filter (where outcome = 'pending') as pending,
        count(*) filter (where outcome = 'sent') as sent,
        count(*) filter (where outcome = 'unknown') as unknown,
        count(*) as total
      from delivery where at >= ${today}
    ), attention as (
      select legacy_business_id as id, name, disconnected,
        (status = 'active' and not connected and not disconnected) as setup,
        failures, webhook_failures as "webhookFailures"
      from business_metrics
      where failures > 0 or webhook_failures > 0 or (status = 'active' and not connected)
      order by (failures + webhook_failures) desc, disconnected desc, name, legacy_business_id
      limit 8
    )
    select jsonb_build_object(
      'breakdown', coalesce((select jsonb_object_agg(vertical, metrics) from product_metrics), '{}'),
      'days', (select jsonb_agg(to_jsonb(series) order by date) from series),
      'health', (select to_jsonb(health) from health),
      'attention', coalesce((select jsonb_agg(to_jsonb(attention) order by failures + "webhookFailures" desc, disconnected desc, name, id) from attention), '[]'),
      'activity', coalesce((select jsonb_agg(to_jsonb(recent) order by at desc, id, event)
        from (select * from timeline order by at desc, id, event limit 8) recent), '[]'),
      'directory', ${product ? sql`coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.legacy_business_id, 'name', b.name, 'product', b.vertical, 'kind', b.kind,
        'active', b.status = 'active', 'createdAt', b.created_at,
        'whatsapp', case when b.connected then 'connected' when b.disconnected then 'disconnected'
          when b.configured then 'setup' else 'not_connected' end,
        'lastActivity', (select max(m.at) from messages m where m.tenant = b.id)
      ) order by b.name, b.legacy_business_id) from business_metrics b), '[]')` : sql`'[]'::jsonb`},
      'productActivity', ${productActivity}
    ) as overview
  `);
  const data = payload.rows[0].overview;
  const breakdown = columns.map(product => ({ product, metrics: data.breakdown[product] ?? zero() }));
  const metrics = zero();
  for (const entry of breakdown) {
    for (const key of Object.keys(metrics) as (keyof OverviewMetrics)[]) metrics[key] += entry.metrics[key];
  }
  return { ...data, metrics, breakdown };
}
