-- D1 setup ownership/revision protocol. Additive; Firestore remains authoritative by default.
ALTER TABLE whatsapp_accounts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_mapping_phone_owner ON whatsapp_phone_mappings(phone_number_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_business_revision ON whatsapp_accounts(business_id, revision);
