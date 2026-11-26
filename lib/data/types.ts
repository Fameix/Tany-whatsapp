export type DatabaseMode = "firestore" | "d1" | "dual" | "postgres" | "dual-write";
export type BusinessRecord = { id: string; name: string; vertical: string; active: boolean; products: string[]; whatsappPhoneNumberId: string; settings: Record<string, unknown> };
export type SubscriptionRecord = { businessId: string; plan: string; status: string; startedAt: number; expiresAt: number };
export type EntitlementRecord = { businessId: string; whatsappAutomation: boolean; campaigns: boolean; advancedAnalytics: boolean; aiAssistant: boolean };
export type TenantRow = Record<string, unknown> & { id: string; businessId: string };
export type WhatsAppAccountRecord = TenantRow & {
  phoneNumberId: string; status: string; wabaId?: string; displayPhone?: string; displayName?: string; tokenSecretName?: string;
  vertical?: string; setupType?: string; businessName?: string; setupStep?: number; revision?: number;
  testPassed?: boolean; testMessage?: string; validationMode?: string | null; testedAt?: Date | null;
  catalogId?: string; catalogEnabled?: boolean; activatedAt?: Date | null; internalTestingActive?: boolean; testStatus?: string;
};
export type SubscriptionEntitlementWrite = {
  businessId: string; plan: string; status: string; startedAt: number; expiresAt: number;
  whatsappAutomation: boolean; campaigns: boolean; advancedAnalytics: boolean; aiAssistant: boolean;
};
export interface MessagingRepository {
  getBusiness(id: string): Promise<BusinessRecord | null>;
  findActiveBusinessByPhoneNumberId(phoneNumberId: string): Promise<BusinessRecord | null>;
  getSubscriptionAndEntitlement(businessId: string): Promise<{ subscription: SubscriptionRecord | null; entitlement: EntitlementRecord | null }>;
  writeSubscriptionEntitlement(input: SubscriptionEntitlementWrite): Promise<void>;
  getWhatsAppAccount(businessId: string): Promise<WhatsAppAccountRecord | null>;
  findWhatsAppAccountByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppAccountRecord | null>;
  getTenantRow(table: string, businessId: string, id: string): Promise<TenantRow | null>;
  listTenantRows(table: string, businessId: string): Promise<TenantRow[]>;
  updateMessageState(businessId: string, id: string, update: Record<string, unknown>): Promise<TenantRow>;
  hasOutgoingReply(businessId: string, incomingMessageId: string): Promise<boolean>;
  storeOutgoingReply(row: TenantRow & { incomingMessageId: string }): Promise<void>;
  storeDeliveryEvent(row: TenantRow & { messageId: string; status: string }): Promise<void>;
  reservePhoneMapping(businessId: string, phoneNumberId: string): Promise<void>;
  compareAndSwapWhatsAppSetup(businessId: string, expectedRevision: number, update: TenantRow): Promise<number>;
  upsertTenantRow(table: string, row: TenantRow): Promise<void>;
}
export type D1Statement = { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
export type D1Like = { prepare(query: string): D1Statement };
