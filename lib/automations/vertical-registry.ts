import type { Action, AutomationInput, Condition, TriggerType } from "@/lib/automations/model";
import type { ActiveTanyVertical } from "@/lib/messaging/vertical-config";

export type ActiveAutomationVertical = ActiveTanyVertical;
/** An automation recipe sets up a workflow: trigger, conditions and a "Send WhatsApp template"
 * action with suggested variable mappings. It owns no message copy: the message always
 * comes from an approved template in the business's Templates library. */
export type AutomationRecipe = {
  id: string;
  vertical: ActiveAutomationVertical;
  name: string;
  description: string;
  trigger: AutomationInput["trigger"];
  conditions: Condition[];
  /** Starter template name this recipe pairs with; any approved template can be chosen. */
  suggestedTemplate: string;
  /** Suggested value per template variable: an automation placeholder token, or "" for custom text. */
  mapping: string[];
};
export type VerticalDataAdapter = { entity: "order" | "vehicle" | "ride"; hooks: readonly string[] };
type VerticalDefinition = {
  label: string; description: string; supportedTriggers: readonly string[]; supportedActions: readonly string[];
  automationTriggers: readonly TriggerType[]; automationActions: readonly Action["type"][];
  featureFlags: Readonly<Record<string, boolean>>; adapter: VerticalDataAdapter; recipes: readonly AutomationRecipe[];
};

const token = (name: string) => `{{${name}}}`;
const recipe = (vertical: ActiveAutomationVertical, key: string, name: string, description: string, trigger: AutomationInput["trigger"], conditions: Condition[], suggestedTemplate: string, mapping: string[]): AutomationRecipe =>
  ({ id: `${vertical}_${key}`, vertical, name, description, trigger, conditions, suggestedTemplate, mapping });
const orderStatus = (vertical: ActiveAutomationVertical, key: string, name: string, state: string, suggestedTemplate: string, mapping: string[]) =>
  recipe(vertical, key, name, `Send an approved template when an order becomes ${state.replaceAll("_", " ")}.`, { type: "order.status.changed" }, [{ type: "order_status", value: state }], suggestedTemplate, mapping);

const eats: AutomationRecipe[] = [
  orderStatus("eats", "order_confirmed", "Order confirmed automation", "confirmed", "eats_order_confirmed", [token("customer_name"), token("order_id"), token("business_name"), token("amount")]),
  orderStatus("eats", "preparing", "Preparing order automation", "preparing", "eats_preparing_order", [token("customer_name"), token("order_id"), token("business_name"), ""]),
  orderStatus("eats", "out_for_delivery", "Out for delivery automation", "out_for_delivery", "eats_out_for_delivery", [token("customer_name"), token("order_id"), token("business_name"), ""]),
  orderStatus("eats", "delivered", "Order delivered automation", "delivered", "eats_order_delivered", [token("customer_name"), token("order_id"), token("business_name")]),
  recipe("eats", "payment_confirmed", "Payment confirmed automation", "Send an approved template when a payment completes.", { type: "payment.completed" }, [], "eats_payment_confirmed", [token("customer_name"), token("amount"), token("order_id")]),
];
const retail: AutomationRecipe[] = [
  orderStatus("retail", "order_confirmed", "Order confirmed automation", "confirmed", "retail_order_confirmed", [token("customer_name"), token("order_id"), token("amount")]),
  orderStatus("retail", "ready", "Ready for pickup automation", "ready", "retail_order_ready", [token("customer_name"), token("order_id"), "", ""]),
  orderStatus("retail", "out_for_delivery", "Order shipped automation", "out_for_delivery", "retail_order_shipped", [token("customer_name"), token("order_id"), "", ""]),
  orderStatus("retail", "delivered", "Order delivered automation", "delivered", "retail_order_delivered", [token("customer_name"), token("order_id"), token("business_name")]),
];
const motos: AutomationRecipe[] = [
  recipe("motos", "test_drive_confirmed", "Test drive confirmed automation", "Send an approved template when a test drive booking is confirmed.", { type: "booking.status.changed" }, [{ type: "booking_status", value: "confirmed" }], "motos_test_drive_confirmed", [token("customer_name"), "", token("booking_date"), token("booking_time"), ""]),
  recipe("motos", "lead_followup", "Lead follow-up automation", "Follow up with a lead who hasn't replied for a day.", { type: "conversation.no_reply", hours: 24 }, [], "motos_lead_followup", [token("customer_name"), ""]),
];

export const verticalRegistry: Record<ActiveAutomationVertical, VerticalDefinition> = {
  eats: { label: "Tany Eats", description: "Order and delivery automations", supportedTriggers: ["customer.message", "order.created", "order.confirmed", "order.preparing", "order.out_for_delivery", "order.delivered", "payment.pending", "business.closed"], supportedActions: ["send_text", "buttons", "list", "wait", "assign_staff", "pause_automation", "payment_cta", "location", "end", "show_menu", "show_order_status", "feedback"], automationTriggers: ["customer.message.received", "keyword.matched", "order.created", "order.status.changed", "booking.created", "booking.status.changed", "payment.completed", "conversation.no_reply", "schedule.triggered", "conversation.started"], automationActions: ["text", "buttons", "list", "template", "location", "payment_link", "handoff", "tag", "state", "delay", "end"], featureFlags: { catalog: true, booking: false, ride: false }, adapter: { entity: "order", hooks: ["menu", "order_status", "payment"] }, recipes: eats },
  retail: { label: "Tany Retail", description: "Retail order and pickup automations", supportedTriggers: ["customer.message", "order.created", "order.confirmed", "order.ready"], supportedActions: ["send_text", "buttons", "list", "wait", "assign_staff", "pause_automation", "end"], automationTriggers: ["customer.message.received", "keyword.matched", "order.created", "order.status.changed", "conversation.no_reply", "schedule.triggered", "conversation.started"], automationActions: ["text", "buttons", "list", "template", "handoff", "tag", "state", "delay", "end"], featureFlags: { catalog: true, booking: false, ride: false }, adapter: { entity: "order", hooks: ["catalog", "order_status"] }, recipes: retail },
  motos: { label: "Tany Motos", description: "Vehicle leads and test-drive automations", supportedTriggers: ["customer.message", "lead.created", "vehicle.enquiry", "test_drive.requested", "test_drive.confirmed", "finance.enquiry", "vehicle.sold", "lead.inactive"], supportedActions: ["send_text", "buttons", "list", "wait", "assign_staff", "pause_automation", "end", "show_vehicle", "send_vehicle_details", "request_test_drive", "finance_cta", "suggest_alternatives", "assign_sales_staff"], automationTriggers: ["customer.message.received", "keyword.matched", "booking.created", "booking.status.changed", "conversation.no_reply"], automationActions: ["text", "buttons", "list", "template", "delay", "handoff", "end"], featureFlags: { catalog: false, vehicle_cards: true, test_drive: true, ride: false }, adapter: { entity: "vehicle", hooks: ["vehicle", "test_drive", "finance"] }, recipes: motos },
};
export function isActiveAutomationVertical(value: unknown): value is ActiveAutomationVertical { return typeof value === "string" && Object.hasOwn(verticalRegistry, value); }
export function getVerticalDefinition(vertical: unknown) { return isActiveAutomationVertical(vertical) ? verticalRegistry[vertical] : null; }
export function recipesForRegisteredVertical(vertical: unknown): AutomationRecipe[] { const definition = getVerticalDefinition(vertical); return definition ? JSON.parse(JSON.stringify(definition.recipes)) : []; }
export function recipesForEnabledProducts(products: readonly ActiveAutomationVertical[]): AutomationRecipe[] {
  return products.flatMap((product) => recipesForRegisteredVertical(product));
}
export function assertVerticalAutomationAllowed(vertical: unknown, input: AutomationInput) { const definition = getVerticalDefinition(vertical); if (!definition) return input; if (!definition.automationTriggers.includes(input.trigger.type)) throw new Error("This trigger is not available for this product."); if (input.actions.some(action => !definition.automationActions.includes(action.type))) throw new Error("This action is not available for this product."); return input; }
