import { boolean, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Local tenant root for the standalone Tany Messaging Neon database. */
export const messagingBusinesses = pgTable("messaging_businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalBusinessId: text("external_business_id"),
  legacyBusinessId: text("legacy_business_id").notNull().unique(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),
  status: text("status").notNull().default("active"),
  whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
  products: jsonb("products").notNull().default([]),
  settings: jsonb("settings").notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("messaging_businesses_external_business_id_unique").on(table.externalBusinessId), uniqueIndex("messaging_businesses_whatsapp_phone_unique").on(table.whatsappPhoneNumberId)]);

export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().unique().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  product: text("product"),
  wabaId: text("waba_id"),
  phoneNumberId: text("phone_number_id").unique(),
  displayPhone: text("display_phone"),
  displayName: text("display_name"),
  tokenSecretName: text("token_secret_name").notNull(),
  status: text("status").notNull().default("pending"),
  testPassed: boolean("test_passed").notNull().default(false),
  validationMode: text("validation_mode"),
  testMessage: text("test_message"),
  testedAt: timestamp("tested_at", { withTimezone: true }),
  setupType: text("setup_type").notNull().default("existing"),
  businessName: text("business_name").notNull().default(""),
  setupStep: integer("setup_step").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  catalogId: text("catalog_id").notNull().default(""),
  catalogEnabled: boolean("catalog_enabled").notNull().default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  internalTestingActive: boolean("internal_testing_active").notNull().default(false),
  testStatus: text("test_status").notNull().default("unverified"),
  ...timestamps,
});

export const whatsappPhoneMappings = pgTable("whatsapp_phone_mappings", {
  phoneNumberId: text("phone_number_id").primaryKey(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  whatsappAccountId: uuid("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "restrict" }),
  ...timestamps,
}, (table) => [index("whatsapp_phone_mappings_business_idx").on(table.messagingBusinessId)]);

export const messagingCatalogItems = pgTable("messaging_catalog_items", {
  id: text("id").notNull(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  type: text("type").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  price: doublePrecision("price").notNull(),
  available: boolean("available").notNull().default(true),
  category: text("category"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("messaging_catalog_items_business_id_unique").on(table.messagingBusinessId, table.id), index("messaging_catalog_items_business_type_idx").on(table.messagingBusinessId, table.type)]);

export const whatsappCatalogProductMappings = pgTable("whatsapp_catalog_product_mappings", {
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  tanyProductId: text("tany_product_id").notNull(),
  retailerProductId: text("retailer_product_id").notNull(),
  catalogId: text("catalog_id").notNull(),
  whatsappReviewStatus: text("whatsapp_review_status"),
  whatsappAvailability: text("whatsapp_availability"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("whatsapp_catalog_mapping_product_unique").on(table.messagingBusinessId, table.tanyProductId), uniqueIndex("whatsapp_catalog_mapping_retailer_unique").on(table.messagingBusinessId, table.catalogId, table.retailerProductId)]);

export const whatsappContacts = pgTable("whatsapp_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  legacyCustomerId: text("legacy_customer_id"),
  phoneEnc: text("phone_enc").notNull(),
  phoneHash: text("phone_hash").notNull(),
  waId: text("wa_id"),
  profileName: text("profile_name"),
  ...timestamps,
}, (table) => [uniqueIndex("whatsapp_contacts_business_phone_hash_unique").on(table.messagingBusinessId, table.phoneHash)]);

export const whatsappConversations = pgTable("whatsapp_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  contactId: uuid("contact_id").references(() => whatsappContacts.id, { onDelete: "restrict" }),
  legacyContactId: text("legacy_contact_id"),
  vertical: text("vertical"),
  state: text("state").notNull().default("start"),
  status: text("status").notNull().default("active"),
  handoffStatus: text("handoff_status").notNull().default("bot"),
  context: jsonb("context").notNull().default({}),
  lastIncomingText: text("last_incoming_text").notNull().default(""),
  pendingReply: text("pending_reply"),
  lastIncomingAt: timestamp("last_incoming_at", { withTimezone: true }),
  lastOutgoingAt: timestamp("last_outgoing_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("whatsapp_conversations_business_legacy_contact_unique").on(table.messagingBusinessId, table.legacyContactId)]);

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  conversationId: uuid("conversation_id").references(() => whatsappConversations.id, { onDelete: "restrict" }),
  metaMessageId: text("meta_message_id").notNull().unique(),
  direction: text("direction").notNull(),
  sourceMessageId: text("source_message_id"),
  type: text("type").notNull().default("text"),
  body: text("body"),
  payload: jsonb("payload").notNull().default({}),
  processingStatus: text("processing_status").notNull().default("pending"),
  deliveryStatus: text("delivery_status").notNull().default("unknown"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("whatsapp_messages_business_conversation_idx").on(table.messagingBusinessId, table.conversationId), uniqueIndex("whatsapp_messages_business_source_reply_unique").on(table.messagingBusinessId, table.sourceMessageId)]);

export const whatsappMessageEvents = pgTable("whatsapp_message_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  metaEventId: text("meta_event_id").notNull().unique(),
  metaMessageId: text("meta_message_id").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  legacyTemplateId: text("legacy_template_id"),
  metaTemplateId: text("meta_template_id"),
  name: text("name").notNull(),
  language: text("language").notNull().default("en"),
  category: text("category"),
  status: text("status").notNull().default("draft"),
  body: text("body").notNull().default(""),
  variables: jsonb("variables").notNull().default({}),
  definition: jsonb("definition").notNull().default({}),
  ...timestamps,
}, (table) => [
  uniqueIndex("whatsapp_templates_business_name_language_unique").on(table.messagingBusinessId, table.name, table.language),
  uniqueIndex("whatsapp_templates_business_legacy_id_unique").on(table.messagingBusinessId, table.legacyTemplateId),
]);

/** Automation-owned data is intentionally separate from Firestore-owned tenant
 * identity/configuration. Stable legacy ids make backfills and retries idempotent. */
export const automationDefinitions = pgTable("automation_definitions", {
  id: text("id").primaryKey(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  product: text("product").notNull(),
  status: text("status").notNull().default("draft"),
  definition: jsonb("definition").notNull().default({}),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("automation_definitions_business_status_idx").on(table.messagingBusinessId, table.status)]);

export const automationEvents = pgTable("automation_events", {
  id: text("id").primaryKey(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("pending"),
  event: jsonb("event").notNull().default({}),
  automationIds: jsonb("automation_ids").notNull().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("automation_events_business_status_idx").on(table.messagingBusinessId, table.status)]);

export const automationRuns = pgTable("automation_runs", {
  id: text("id").primaryKey(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  automationId: text("automation_id").notNull(),
  trigger: text("trigger").notNull(),
  status: text("status").notNull().default("running"),
  run: jsonb("run").notNull().default({}),
  resumeAt: timestamp("resume_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("automation_runs_business_status_idx").on(table.messagingBusinessId, table.status)]);

export const automationStates = pgTable("automation_states", {
  id: text("id").primaryKey(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  automationId: text("automation_id"),
  conversationId: text("conversation_id"),
  status: text("status").notNull().default("active"),
  state: jsonb("state").notNull().default({}),
  ...timestamps,
}, (table) => [index("automation_states_business_status_idx").on(table.messagingBusinessId, table.status)]);

export const whatsappIdentities = pgTable("whatsapp_identities", {
  phone: text("phone").primaryKey(),
  uid: text("uid").notNull(),
  linked: boolean("linked").notNull().default(true),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappLinkSessions = pgTable("whatsapp_link_sessions", {
  token: text("token").primaryKey(),
  whatsappPhone: text("whatsapp_phone").notNull(),
  legacyBusinessId: text("legacy_business_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  pendingIntent: text("pending_intent"),
  notificationStatus: text("notification_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("whatsapp_link_sessions_phone_business_used_idx").on(table.whatsappPhone, table.legacyBusinessId, table.used)]);

export const whatsappCustomerLinks = pgTable("whatsapp_customer_links", {
  legacyBusinessId: text("legacy_business_id").notNull(),
  whatsappPhone: text("whatsapp_phone").notNull(),
  uid: text("uid").notNull(),
  linked: boolean("linked").notNull().default(true),
  pendingIntent: text("pending_intent"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("whatsapp_customer_links_business_phone_unique").on(table.legacyBusinessId, table.whatsappPhone), index("whatsapp_customer_links_phone_idx").on(table.whatsappPhone)]);

export const messagingSubscriptions = pgTable("messaging_subscriptions", {
  legacyBusinessId: text("legacy_business_id").primaryKey(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  whatsappAutomation: boolean("whatsapp_automation").notNull().default(false),
  campaigns: boolean("campaigns").notNull().default(false),
  advancedAnalytics: boolean("advanced_analytics").notNull().default(false),
  aiAssistant: boolean("ai_assistant").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappAutomationState = pgTable("whatsapp_automation_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  conversationId: uuid("conversation_id").notNull().references(() => whatsappConversations.id, { onDelete: "restrict" }),
  automationKey: text("automation_key").notNull(),
  status: text("status").notNull().default("active"),
  state: text("state").notNull().default("start"),
  context: jsonb("context").notNull().default({}),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("whatsapp_automation_state_conversation_key_unique").on(table.conversationId, table.automationKey)]);

export const whatsappWebhookEvents = pgTable("whatsapp_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  metaEventId: text("meta_event_id").notNull().unique(),
  payload: jsonb("payload").notNull().default({}),
  processingStatus: text("processing_status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tenant-scoped compatibility rows for messaging domain records whose legacy
 * shape is intentionally JSON based (orders, payments, bookings, and context). */
export const messagingRuntimeRecords = pgTable("messaging_runtime_records", {
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  collection: text("collection").notNull(),
  legacyId: text("legacy_id").notNull(),
  data: jsonb("data").notNull().default({}),
  ...timestamps,
}, (table) => [uniqueIndex("messaging_runtime_records_tenant_key_unique").on(table.messagingBusinessId, table.collection, table.legacyId), index("messaging_runtime_records_collection_idx").on(table.messagingBusinessId, table.collection)]);

export const messagingAuthUsers = pgTable("messaging_auth_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const messagingAuthUserBusinesses = pgTable("messaging_auth_user_businesses", {
  userId: uuid("user_id").notNull().references(() => messagingAuthUsers.id, { onDelete: "cascade" }),
  messagingBusinessId: uuid("messaging_business_id").notNull().references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("messaging_auth_user_businesses_user_tenant_unique").on(table.userId, table.messagingBusinessId), index("messaging_auth_user_businesses_tenant_idx").on(table.messagingBusinessId)]);

export const messagingPhoneLoginChallenges = pgTable("messaging_phone_login_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: text("phone").notNull(),
  /** Set for WhatsApp OTP: the business whose own number sent the code. The same phone is a
   * separate login in each business. Null for the original SMS sign-in. */
  messagingBusinessId: uuid("messaging_business_id").references(() => messagingBusinesses.id, { onDelete: "cascade" }),
  ipHash: text("ip_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("messaging_phone_login_challenges_phone_created_idx").on(table.phone, table.createdAt), index("messaging_phone_login_challenges_ip_created_idx").on(table.ipHash, table.createdAt), index("messaging_phone_login_challenges_tenant_phone_created_idx").on(table.messagingBusinessId, table.phone, table.createdAt)]);

export const messagingPhoneLoginSessions = pgTable("messaging_phone_login_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => messagingAuthUsers.id, { onDelete: "cascade" }),
  selectedBusinessId: uuid("selected_business_id").references(() => messagingBusinesses.id, { onDelete: "restrict" }),
  /** A WhatsApp OTP session belongs to one business; it can never be switched to another. */
  tenantLocked: boolean("tenant_locked").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("messaging_phone_login_sessions_user_expiry_idx").on(table.userId, table.expiresAt)]);
