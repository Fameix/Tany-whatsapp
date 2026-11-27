import "server-only";
import { sql } from "drizzle-orm";
import { postgresDb } from "@/lib/data/postgres-client";

/** Read stored diagnostics only. Never contact Meta just to render the connection panel. */
export async function getProductWhatsAppDiagnostics(businessId: string) {
  const { rows } = await postgresDb().execute<{
    quality: string | null; display_name_status: string | null; webhook_status: string | null;
    last_webhook: string | null; webhook_processing: string | null; last_incoming: string | null;
    last_outgoing: string | null; last_delivery: string | null;
  }>(sql`
    select b.settings#>>'{whatsapp,qualityRating}' as quality,
      b.settings#>>'{whatsapp,displayNameStatus}' as display_name_status,
      b.settings#>>'{whatsapp,webhookVerification}' as webhook_status,
      w.received_at::text as last_webhook, w.processing_status as webhook_processing,
      incoming.at::text as last_incoming, outgoing.at::text as last_outgoing, outgoing.status as last_delivery
    from messaging_businesses b
    left join lateral (
      select received_at, processing_status from whatsapp_webhook_events
      where messaging_business_id = b.id order by received_at desc limit 1
    ) w on true
    left join lateral (
      select max(coalesce(provider_timestamp, created_at)) as at
      from whatsapp_messages where messaging_business_id = b.id and direction = 'incoming'
    ) incoming on true
    left join lateral (
      select at, status from (
        select coalesce(provider_timestamp, created_at) as at, delivery_status as status
        from whatsapp_messages where messaging_business_id = b.id and direction = 'outgoing'
        union all
        select r.created_at, r.data->>'deliveryStatus'
        from messaging_runtime_records r where r.messaging_business_id = b.id and r.collection = 'messages'
          and r.data->>'direction' = 'outgoing'
          and not exists (
            select 1 from whatsapp_messages m where m.messaging_business_id = b.id
              and m.meta_message_id = coalesce(nullif(r.data->>'messageId', ''), r.legacy_id)
          )
      ) messages order by at desc limit 1
    ) outgoing on true
    where b.legacy_business_id = ${businessId}
    limit 1
  `);
  return rows[0];
}
