# Cloudflare D1 migration map (Phase 1)

Firestore remains the authoritative runtime database in this phase. `MESSAGING_DATABASE=dual` only mirrors explicit, safe writes to D1; it never serves production reads from D1.

| Current Firestore area | D1 destination | Cutover dependency |
| --- | --- | --- |
| `businesses/{businessId}` | `businesses` | Backfill the business record, products and account identifiers. |
| `subscriptions/{businessId}`, `entitlements/{businessId}` | `subscriptions`, `entitlements` | Timestamp conversion and reconciliation with the billing source of truth. |
| WhatsApp account/setup records and phone lookup mappings | `whatsapp_accounts`, `whatsapp_phone_mappings` | Preserve unique phone ownership and webhook lookup behavior. |
| Customer/contact records | `customers` | Stable business-scoped identifiers and phone normalization backfill. |
| Conversation and message records | `conversations`, `messages`, `message_delivery_events` | Event ordering, idempotency and retention plan. |
| Automation definitions, logs and scheduled work | `automations`, `automation_events`, `automation_runs` | Preserve local-draft semantics; move lock/idempotency to Durable Objects before read cutover. |
| Template and campaign records | `templates`, `campaigns` | Validate purchased-product ownership at every write and read. |
| Dashboard handoff records | `dashboard_handoffs` | Retain expiry/one-time-use behavior. |

All D1 rows with tenant data carry `business_id` and a foreign key to `businesses`. Product columns are constrained to `eats`, `motos`, or `cabs`; unknown verticals cannot be imported as active messaging products.

## Firebase import audit

Firebase Admin is currently initialized in `lib/firebase-admin.ts`; client Firebase is initialized in `lib/firebase.ts`. Direct Admin SDK consumers remain in the messaging, automation, WhatsApp setup/catalog, admin-workspace and development test-route layers. The Phase 1 repository adapter (`lib/data/firestore-repository.ts`) isolates the new business/subscription/entitlement reads, but the remaining call sites require transaction-by-transaction adapters before D1 can safely become read-authoritative.

The next migration slice should prioritize webhook phone lookup, conversation/message persistence, automation transaction/idempotency and WhatsApp setup mappings, because those paths are stateful and security-sensitive.
