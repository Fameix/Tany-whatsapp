import "server-only";
import { adminDb } from "@/lib/firebase-admin";
import { databaseMode } from "@/lib/data/repository";
import { listRuntimeRecords } from "@/lib/messaging/services/postgres-runtime-records";
import { getOrder } from "@/lib/messaging/services/order-service";
import { getAvailableCatalogItems } from "@/lib/messaging/services/catalog-service";
import { buttonReply, listReply, textReply } from "@/lib/messaging/replies";
import type { ConversationContext, Order } from "@/lib/messaging/domain-types";
import type { FlowContext, FlowResult, IncomingMessageInput, MessagingReply } from "@/lib/messaging/types";
import { handleCommerceMessage } from "@/lib/messaging/flows/commerce-flow";

const menu = (businessName: string) => listReply({
  body: `Welcome to ${businessName}. How can we help?`, buttonText: "Choose option",
  sections: [{ rows: [
    { id: "retail_menu_shop", title: "Shop Products" },
    { id: "retail_menu_track", title: "Track Order" },
    { id: "retail_menu_offers", title: "Offers" },
    { id: "retail_menu_support", title: "Support" },
  ] }],
});

const orderLabel = (status: string) => ({
  draft: "Received", pending_confirmation: "Awaiting confirmation", awaiting_payment: "Awaiting payment",
  paid: "Confirmed", confirmed: "Confirmed", preparing: "Preparing", packed: "Packed",
  out_for_delivery: "Out for delivery", ready: "Ready for pickup", delivered: "Delivered", cancelled: "Cancelled",
}[status] ?? "Received");

export async function handleRetailMessage(input: string | IncomingMessageInput, flow?: FlowContext): Promise<FlowResult> {
  const business = flow?.business;
  const phone = flow?.customerPhone ?? flow?.conversation?.customerPhone;
  const selected = typeof input === "string" ? "" : input.selectionId ?? "";
  const text = typeof input === "string" ? input : input.text;
  const context: ConversationContext = { ...flow?.conversation?.context };
  const result = (reply: MessagingReply, state = "retail_main_menu", status: FlowResult["status"] = "waiting_customer"): FlowResult => ({
    reply, state, status, context, vertical: "retail", originalText: text,
  });
  if (!business || !phone) return handleCommerceMessage("retail", input, flow);
  if (selected === "retail_menu_main" || /^(hi|hello|hey|start|menu|main menu)$/i.test(text.trim()))
    return result(menu(business.name));
  if (selected === "retail_menu_shop")
    return handleCommerceMessage("retail", { type: "text", text: "RESET" }, flow);
  if (selected === "retail_menu_support")
    return result(buttonReply({ body: "Choose an option. A team member can take over if we cannot resolve it.", buttons: [
      { id: "retail_support_order", title: "Order help" }, { id: "retail_support_handoff", title: "Talk to staff" }, { id: "retail_menu_main", title: "Main menu" },
    ] }), "retail_support");
  if (selected === "retail_support_handoff" || /^(human|agent|staff|support)$/i.test(text.trim()))
    return result(textReply("A team member will continue this conversation shortly."), "retail_handed_off", "handed_off");
  if (selected === "retail_support_order")
    return result(buttonReply({ body: "You can track your current order or speak with a team member.", buttons: [
      { id: "retail_menu_track", title: "Track Order" }, { id: "retail_support_handoff", title: "Talk to staff" }, { id: "retail_menu_main", title: "Main menu" },
    ] }), "retail_support");
  if (selected === "retail_menu_offers") {
    const offers = (await getAvailableCatalogItems(business.id)).filter((item) => item.metadata.offer === true).slice(0, 10);
    return result(offers.length ? listReply({ body: "Current offers", buttonText: "View products", sections: [{ rows: offers.map((item) => ({ id: `retail_awaiting_product_${item.id}`, title: item.name, description: `₹${item.price}` })) }] }) : buttonReply({ body: "There are no current offers. Browse the latest available products.", buttons: [{ id: "retail_menu_shop", title: "Shop Products" }, { id: "retail_menu_main", title: "Main menu" }] }));
  }
  if (selected === "retail_menu_track") {
    const postgresMode = databaseMode() === "postgres" || databaseMode() === "dual-write";
    const orders = (postgresMode ? await listRuntimeRecords<Order & Record<string, unknown>>("orders", business.id) : (await adminDb.collection("orders").where("businessId", "==", business.id).where("customerPhone", "==", phone).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order))).filter((order) => order.customerPhone === phone && order.vertical === "retail").slice(0, 10);
    if (!orders.length) return result(buttonReply({ body: "No Retail orders were found for this WhatsApp number.", buttons: [{ id: "retail_menu_shop", title: "Shop Products" }, { id: "retail_menu_main", title: "Main menu" }] }));
    return result(listReply({ body: "Select an order to view its current status.", buttonText: "Select order", sections: [{ rows: orders.map((order) => ({ id: `retail_track_${order.id}`, title: `Order ${order.id.slice(-8)}`, description: orderLabel(order.status) })) }] }), "retail_tracking");
  }
  if (selected.startsWith("retail_track_")) {
    const orderId = selected.slice("retail_track_".length);
    const order = await getOrder(orderId);
    const data = order;
    if (!data || data.businessId !== business.id || data.customerPhone !== phone || data.vertical !== "retail") return result(textReply("That order is unavailable."), "retail_main_menu");
    return result(buttonReply({ body: `Order ${orderId}\nStatus: ${orderLabel(data.status)}\nTotal: ₹${data.total}`, buttons: [{ id: "retail_menu_track", title: "Track another" }, { id: "retail_menu_shop", title: "Shop again" }, { id: "retail_menu_support", title: "Support" }] }), "retail_tracking");
  }
  return handleCommerceMessage("retail", input, flow);
}
