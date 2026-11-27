import "server-only";
import { getOperationsData } from "@/lib/admin/operations-service";
import type { OperationConversation, OperationMessage } from "@/lib/admin/operations-types";
import { automationDashboard } from "@/lib/automations/service";
import { EntitlementError } from "@/lib/subscriptions/entitlements";
import { getClientWhatsAppConnection, type ClientWhatsAppConnection } from "@/lib/whatsapp/client-connection";
import { SetupError } from "@/lib/whatsapp/setup-service";
import type { TanyVertical } from "@/lib/messaging/types";

/** Home sections a product can compose. Products choose their order and may add
 * product-specific modules (orders, deliveries, leads) without changing the shell. */
export type HomeModuleId = "attention" | "recent" | "automations";
const defaultModules: HomeModuleId[] = ["attention", "recent", "automations"];
const productModules: Partial<Record<TanyVertical, HomeModuleId[]>> = {};
export const homeModulesFor = (vertical: TanyVertical) => productModules[vertical] ?? defaultModules;

export type HomeConnection = {
  state: "connected" | "attention" | "setup" | "not_connected" | "inactive";
  displayName: string;
  displayPhone: string;
};
export type HomeMetric = {
  id: "needs-reply" | "customers" | "automation-runs" | "messages-sent";
  label: string;
  value: number | null;
  detail: string;
  href: string;
};
export type HomeConversationStatus = "needs_reply" | "handed_off" | "open" | "waiting" | "closed";
export type HomeConversation = {
  id: string;
  name: string;
  phone: string;
  preview: string;
  at: string | null;
  status: HomeConversationStatus;
  unread: number;
  href: string;
};
export type HomeAutomation = { id: string; name: string; status: "active" | "paused" | "draft"; runs: number; failed: number; lastRunAt: string | null };
export type HomeAutomations =
  | { state: "ready"; items: HomeAutomation[]; runs: number; completed: number }
  | { state: "plan" | "unavailable" };

export type BusinessHome = {
  business: { id: string; name: string; vertical: TanyVertical };
  /** When the data was read; relative times are rendered against it. */
  generatedAt: number;
  connection: HomeConnection;
  metrics: HomeMetric[];
  attention: HomeConversation[];
  recent: HomeConversation[];
  automations: HomeAutomations;
  modules: HomeModuleId[];
  links: { inbox: string; customers: string; campaigns: string; automations: string; whatsapp: string };
};

const day = 24 * 60 * 60 * 1000;
const since = (iso: string | null, windowMs: number, now: number) => !!iso && now - Date.parse(iso) <= windowMs;

export function formatPhone(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return phone.startsWith("+") || !digits ? phone : `+${digits}`;
}

/** A customer's message with no reply after it needs attention, whether or not someone has opened it. */
function conversationStatus(conversation: OperationConversation, lastIncoming: boolean): HomeConversationStatus {
  if (conversation.status === "completed" || conversation.status === "cancelled") return "closed";
  if (conversation.status === "handed_off") return "handed_off";
  if (lastIncoming) return "needs_reply";
  if (conversation.status === "waiting_customer" || conversation.status === "waiting_payment") return "waiting";
  return "open";
}

/** An inactive business has no WhatsApp setup to read; Home shows it as inactive instead of failing. */
async function homeConnection(businessId: string): Promise<ClientWhatsAppConnection | null> {
  try {
    return await getClientWhatsAppConnection(businessId);
  } catch (error) {
    if (error instanceof SetupError && error.code === "BUSINESS_UNAVAILABLE") return null;
    throw error;
  }
}

function connectionState(connection: ClientWhatsAppConnection | null): HomeConnection["state"] {
  if (!connection) return "inactive";
  if (connection.status === "connected") return connection.health === "needs_attention" ? "attention" : "connected";
  if (connection.status === "error") return "attention";
  if (connection.status === "pending" || connection.status === "testing") return "setup";
  return "not_connected";
}

async function automationSummary(businessId: string, now: number): Promise<HomeAutomations> {
  try {
    const data = await automationDashboard(businessId);
    const recentRuns = data.runs.filter(run => since(run.startedAt, 7 * day, now));
    const items = data.automations
      .map((automation): HomeAutomation => {
        const runs = recentRuns.filter(run => run.automationId === automation.id);
        return {
          id: automation.id,
          name: automation.name || "Untitled automation",
          status: automation.status,
          runs: runs.length,
          failed: runs.filter(run => run.status === "failed").length,
          lastRunAt: data.runs.find(run => run.automationId === automation.id)?.startedAt ?? null,
        };
      })
      .sort((a, b) => b.runs - a.runs || Number(b.status === "active") - Number(a.status === "active") || a.name.localeCompare(b.name));
    return { state: "ready", items, runs: recentRuns.length, completed: recentRuns.filter(run => run.status === "completed").length };
  } catch (error) {
    // Plan limits and unavailable automation data degrade to an empty state; Home never fails because of them.
    return { state: error instanceof EntitlementError ? "plan" : "unavailable" };
  }
}

/** Everything on Home is read for this one business; nothing is aggregated across tenants. */
export async function getBusinessHome(business: { id: string; name: string; vertical: TanyVertical }, root = `/business/${encodeURIComponent(business.id)}`): Promise<BusinessHome> {
  const now = Date.now();
  const [operations, connection, automations] = await Promise.all([
    getOperationsData(business.id),
    homeConnection(business.id),
    automationSummary(business.id, now),
  ]);
  if (operations.businessId !== business.id) throw new Error("Business home data is not scoped to this business.");

  const byPhone = new Map<string, OperationMessage[]>();
  for (const message of operations.messages) byPhone.set(message.phone, [...(byPhone.get(message.phone) ?? []), message]);
  const conversations = operations.conversations.map((conversation): HomeConversation => {
    const last = byPhone.get(conversation.phone)?.at(-1);
    return {
      id: conversation.id,
      name: conversation.name && conversation.name !== conversation.phone ? conversation.name : formatPhone(conversation.phone),
      phone: formatPhone(conversation.phone),
      preview: conversation.lastMessage || (last ? `${last.type[0].toUpperCase()}${last.type.slice(1)} message` : "No messages yet"),
      at: conversation.at,
      status: conversationStatus(conversation, last?.direction === "incoming"),
      unread: conversation.unread ?? 0,
      href: `${root}/inbox?conversation=${encodeURIComponent(conversation.id)}`,
    };
  });
  const attention = conversations.filter(c => c.status === "needs_reply" || c.status === "handed_off");
  const open = conversations.filter(c => c.status !== "closed").length;

  const incoming24h = operations.messages.filter(m => m.direction === "incoming" && since(m.at, day, now));
  const customers24h = new Set(incoming24h.map(m => m.phone)).size;
  const sent7d = operations.messages.filter(m => m.direction === "outgoing" && since(m.at, 7 * day, now));
  const read7d = sent7d.filter(m => m.status === "read").length;
  const delivered7d = sent7d.filter(m => m.status === "read" || m.status === "delivered").length;

  const metrics: HomeMetric[] = [
    { id: "needs-reply", label: "Needs reply", value: attention.length, detail: `${open} open conversation${open === 1 ? "" : "s"}`, href: `${root}/inbox` },
    { id: "customers", label: "Customers today", value: customers24h, detail: incoming24h.length ? `${incoming24h.length} message${incoming24h.length === 1 ? "" : "s"} · last 24h` : "No messages · last 24h", href: `${root}/contacts` },
    automations.state === "ready"
      ? { id: "automation-runs", label: "Automated replies", value: automations.runs, detail: automations.runs ? `${Math.round((automations.completed / automations.runs) * 100)}% completed · 7 days` : "No runs · last 7 days", href: `${root}/automations` }
      : { id: "automation-runs", label: "Automated replies", value: null, detail: automations.state === "plan" ? "On the Pro plan" : "Not available right now", href: `${root}/automations` },
    { id: "messages-sent", label: "Messages sent", value: sent7d.length, detail: sent7d.length ? `${Math.round((read7d / sent7d.length) * 100)}% read · ${Math.round((delivered7d / sent7d.length) * 100)}% delivered` : "None · last 7 days", href: `${root}/campaigns` },
  ];

  return {
    business,
    generatedAt: now,
    connection: { state: connectionState(connection), displayName: connection?.displayName ?? "", displayPhone: connection?.displayPhone ? formatPhone(connection.displayPhone) : "" },
    metrics,
    attention: attention.slice(0, 5),
    recent: conversations.slice(0, 6),
    automations,
    modules: homeModulesFor(business.vertical),
    links: { inbox: `${root}/inbox`, customers: `${root}/contacts`, campaigns: `${root}/campaigns`, automations: `${root}/automations`, whatsapp: `${root}/whatsapp` },
  };
}
