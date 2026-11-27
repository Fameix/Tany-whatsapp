import "server-only";
import { sql } from "drizzle-orm";

/** Account status for queries with business alias b and account alias a. */
export const postgresWhatsAppStatus = sql`
  case
    when b.status <> 'active' then 'Inactive'
    when a.status = 'disconnected' then 'Disconnected'
    when a.status = 'error' then 'Error'
    when a.status = 'connected' and nullif(a.phone_number_id, '') is not null
      and a.test_passed and a.validation_mode = 'live' and a.tested_at is not null
      and exists (
        select 1 from whatsapp_phone_mappings m
        where m.phone_number_id = a.phone_number_id and m.messaging_business_id = b.id
          and m.whatsapp_account_id = a.id
      ) then 'Connected'
    when a.status in ('pending', 'testing', 'connected') or nullif(a.phone_number_id, '') is not null
      then 'Configured · unverified'
    else 'Not connected'
  end
`;
