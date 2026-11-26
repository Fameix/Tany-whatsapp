import type { TanyVertical } from "@/lib/messaging/types";
import type { TemplateButton, TemplateContent } from "./model";

/** Meta rejects a body that starts or ends on a variable, so every body closes with fixed text.
 *
 * Tany-provided starting points. They are never approved and never stored as a
 * business's template: choosing one creates a draft the business owns and submits. */
export type StarterTemplate = Omit<TemplateContent, "language" | "header" | "footer"> & {
  key: string;
  title: string;
  purpose: string;
};

const url = (text: string): TemplateButton => ({ type: "URL", text, url: "" });
const reply = (text: string): TemplateButton => ({ type: "QUICK_REPLY", text });
const starter = (key: string, title: string, purpose: string, category: StarterTemplate["category"], body: string, examples: string[], buttons: TemplateButton[] = []): StarterTemplate =>
  ({ key, name: key, title, purpose, category, body, examples, buttons });

const retail: StarterTemplate[] = [
  starter("retail_order_confirmed", "Order confirmed", "Confirm a new order and its total.", "utility",
    "Hi {{1}}, your order {{2}} has been confirmed.\n\nOrder total: ₹{{3}}\n\nWe'll let you know when it's ready.",
    ["Priya", "ORD-1042", "1,499"], [url("Track order"), reply("Contact store")]),
  starter("retail_order_ready", "Ready for pickup", "Tell the customer where and when to collect.", "utility",
    "Hi {{1}}, your order {{2}} is ready for pickup at {{3}}.\n\nPickup hours: {{4}}\n\nSee you soon.",
    ["Priya", "ORD-1042", "Anna Nagar store", "10 AM – 9 PM"], [url("Get directions"), reply("Contact store")]),
  starter("retail_order_shipped", "Order shipped", "Share tracking and expected delivery.", "utility",
    "Hi {{1}}, your order {{2}} has been shipped.\n\nTracking reference: {{3}}\n\nExpected delivery: {{4}}\n\nThank you for shopping with us.",
    ["Priya", "ORD-1042", "DTDC48213", "28 Nov"], [url("Track order")]),
  starter("retail_order_delivered", "Order delivered", "Confirm delivery and thank the customer.", "utility",
    "Hi {{1}}, your order {{2}} has been delivered.\n\nThank you for shopping with {{3}}.",
    ["Priya", "ORD-1042", "Tany Retail"]),
  starter("retail_payment_reminder", "Payment reminder", "Remind a customer about a pending payment.", "utility",
    "Hi {{1}}, a payment of ₹{{2}} is pending for order {{3}}.\n\nPlease complete the payment to continue processing your order.",
    ["Priya", "1,499", "ORD-1042"], [url("Pay now")]),
  starter("retail_payment_received", "Payment received", "Acknowledge a successful payment.", "utility",
    "Hi {{1}}, we've received your payment of ₹{{2}} for order {{3}}.\n\nThank you.",
    ["Priya", "1,499", "ORD-1042"]),
  starter("retail_back_in_stock", "Back in stock", "Let interested customers know a product is available.", "marketing",
    "Good news, {{1}}.\n\n{{2}} is back in stock at {{3}}.",
    ["Priya", "Cotton kurta (M)", "Tany Retail"], [url("View product")]),
  starter("retail_new_arrival", "New arrivals", "Announce a new collection.", "marketing",
    "Hi {{1}}, new arrivals are now available at {{2}}.\n\nExplore the latest collection today.",
    ["Priya", "Tany Retail"], [url("Shop now")]),
  starter("retail_price_drop", "Price drop", "Share a lower price on a product.", "marketing",
    "Hi {{1}}, the price of {{2}} has just dropped to ₹{{3}}.\n\nAvailable while stocks last.",
    ["Priya", "Wireless earbuds", "1,299"], [url("View product")]),
  starter("retail_special_offer", "Special offer", "Promote a limited-time offer.", "marketing",
    "Hi {{1}}, enjoy {{2}} at {{3}} until {{4}}.\n\nTerms apply.",
    ["Priya", "20% off footwear", "Tany Retail", "30 Nov"], [url("View offer")]),
  starter("retail_enquiry_followup", "Product enquiry follow-up", "Follow up on a product a customer asked about.", "marketing",
    "Hi {{1}}, are you still interested in {{2}}?\n\nWe're happy to help with availability, price or product details.",
    ["Priya", "the leather handbag"], [reply("Chat with us")]),
  starter("retail_feedback", "Feedback request", "Ask for feedback after a purchase.", "marketing",
    "Hi {{1}}, thank you for shopping with {{2}}.\n\nWe'd love to hear about your experience.",
    ["Priya", "Tany Retail"], [reply("Share feedback")]),
];

const eats: StarterTemplate[] = [
  starter("eats_order_confirmed", "Order confirmed", "Confirm a food order and its total.", "utility",
    "Hi {{1}}, your order {{2}} has been confirmed by {{3}}.\n\nTotal: ₹{{4}}\n\nWe'll update you as it progresses.",
    ["Arjun", "#2045", "Spice Route Kitchen", "640"], [url("Track order")]),
  starter("eats_preparing_order", "Preparing your order", "Let the customer know the kitchen has started.", "utility",
    "Hi {{1}}, {{3}} has started preparing order {{2}}.\n\nEstimated preparation time: {{4}}.",
    ["Arjun", "#2045", "Spice Route Kitchen", "20 minutes"]),
  // Meta rejects a body that ends on a variable, so the closing line is fixed text.
  starter("eats_order_ready", "Order ready", "Say the order is ready; keep the button that fits delivery or pickup.", "utility",
    "Hi {{1}}, your order {{2}} is ready.\n\n{{3}}\n\nThank you for ordering with us.",
    ["Arjun", "#2045", "Our delivery partner is picking it up now."], [url("Track delivery"), url("Get directions")]),
  starter("eats_out_for_delivery", "Out for delivery", "Share that the order is on its way.", "utility",
    "Hi {{1}}, your order {{2}} from {{3}} is on the way.\n\nExpected arrival: {{4}}.",
    ["Arjun", "#2045", "Spice Route Kitchen", "8:15 PM"], [url("Track order")]),
  starter("eats_order_delivered", "Order delivered", "Confirm the order was delivered.", "utility",
    "Hi {{1}}, your order {{2}} has been delivered.\n\nEnjoy your meal from {{3}}!",
    ["Arjun", "#2045", "Spice Route Kitchen"]),
  starter("eats_pickup_ready", "Ready for pickup", "Tell the customer their pickup order is ready.", "utility",
    "Hi {{1}}, your order {{2}} is ready for pickup at {{3}}.",
    ["Arjun", "#2045", "Spice Route Kitchen, T. Nagar"], [url("Get directions")]),
  starter("eats_payment_confirmed", "Payment confirmed", "Acknowledge payment for an order.", "utility",
    "Hi {{1}}, payment of ₹{{2}} for order {{3}} has been received.\n\nThank you.",
    ["Arjun", "640", "#2045"]),
  starter("eats_order_delayed", "Order delayed", "Apologise for a delay and share the new time.", "utility",
    "Hi {{1}}, we're sorry — order {{2}} is taking a little longer than expected.\n\nUpdated expected time: {{3}}.\n\nThank you for your patience.",
    ["Arjun", "#2045", "8:40 PM"]),
  starter("eats_order_cancelled", "Order cancelled", "Confirm a cancellation and the reason.", "utility",
    "Hi {{1}}, order {{2}} has been cancelled.\n\n{{3}}\n\nIf a refund applies, we'll update you separately.",
    ["Arjun", "#2045", "The restaurant is closed due to a power outage."]),
  starter("eats_reorder_favourite", "Reorder your favourite", "Invite a repeat order of a favourite dish.", "marketing",
    "Hi {{1}}, craving {{2}} again?\n\nReorder from {{3}} in just a few taps.",
    ["Arjun", "Chicken biryani", "Spice Route Kitchen"], [url("Order now")]),
  starter("eats_special_offer", "Today's offer", "Promote a same-day offer.", "marketing",
    "Hi {{1}}, enjoy {{2}} at {{3}} today.\n\nOffer valid until {{4}}.",
    ["Arjun", "a free dessert with every combo", "Spice Route Kitchen", "11 PM"], [url("Order now")]),
  starter("eats_feedback", "How was your order?", "Ask for a rating after delivery.", "marketing",
    "Hi {{1}}, how was your order from {{2}}?\n\nYour feedback helps us serve you better.",
    ["Arjun", "Spice Route Kitchen"], [reply("Rate order")]),
];

const motos: StarterTemplate[] = [
  starter("motos_enquiry_received", "Enquiry received", "Acknowledge a new vehicle enquiry.", "utility",
    "Hi {{1}}, we've received your enquiry for {{2}}.\n\nA member of {{3}} will assist you shortly.",
    ["Rahul", "Honda City 2021", "Tany Motors"]),
  starter("motos_vehicle_details", "Vehicle details", "Share the key details of a vehicle.", "utility",
    "Hi {{1}}, here are the details for {{2}}.\n\nPrice: ₹{{3}}\nYear: {{4}}\nKM driven: {{5}}\n\nReply here if you have any questions.",
    ["Rahul", "Honda City VX", "8,75,000", "2021", "32,400"], [url("View vehicle"), reply("Contact dealer")]),
  starter("motos_test_drive_confirmed", "Test drive confirmed", "Confirm a booked test drive.", "utility",
    "Hi {{1}}, your test drive for {{2}} is confirmed.\n\nDate: {{3}}\nTime: {{4}}\nLocation: {{5}}\n\nWe look forward to seeing you.",
    ["Rahul", "Honda City VX", "29 Nov", "11:00 AM", "Tany Motors, OMR"], [url("Get directions"), reply("Contact dealer")]),
  starter("motos_test_drive_reminder", "Test drive reminder", "Remind a customer of an upcoming test drive.", "utility",
    "Hi {{1}}, this is a reminder for your test drive of {{2}}.\n\nDate: {{3}}\nTime: {{4}}\n\nSee you at {{5}}.",
    ["Rahul", "Honda City VX", "29 Nov", "11:00 AM", "Tany Motors, OMR"]),
  starter("motos_appointment_rescheduled", "Appointment rescheduled", "Share a new appointment time.", "utility",
    "Hi {{1}}, your appointment for {{2}} has been rescheduled.\n\nNew date: {{3}}\nNew time: {{4}}\n\nReply here if this time doesn't work for you.",
    ["Rahul", "Honda City VX", "30 Nov", "3:30 PM"]),
  starter("motos_service_booking", "Service booking confirmed", "Confirm a service booking.", "utility",
    "Hi {{1}}, your service booking for {{2}} is confirmed.\n\nDate: {{3}}\nTime: {{4}}\nBooking reference: {{5}}\n\nWe look forward to seeing you.",
    ["Rahul", "TN 09 AB 1234", "2 Dec", "9:30 AM", "SRV-5521"]),
  starter("motos_service_ready", "Vehicle ready", "Tell the customer their serviced vehicle is ready.", "utility",
    "Hi {{1}}, your {{2}} is ready after service.\n\nAmount due: ₹{{3}}\n\nYou can collect the vehicle from {{4}}.",
    ["Rahul", "Honda City", "4,850", "Tany Motors service centre"]),
  starter("motos_quote_shared", "Quote shared", "Share a price quote for a vehicle.", "utility",
    "Hi {{1}}, we've prepared a quote for {{2}}.\n\nQuoted price: ₹{{3}}\n\nPlease contact us if you'd like to proceed or discuss the offer.",
    ["Rahul", "Honda City VX", "8,60,000"]),
  starter("motos_finance_followup", "Finance follow-up", "Follow up on financing for a vehicle.", "utility",
    "Hi {{1}}, we're following up regarding financing for {{2}}.\n\nLet us know if you'd like assistance with available finance options.",
    ["Rahul", "Honda City VX"]),
  starter("motos_vehicle_available", "Vehicle available", "Confirm an enquired vehicle is in stock.", "utility",
    "Hi {{1}}, the {{2}} you enquired about is currently available at {{3}}.",
    ["Rahul", "Honda City VX", "Tany Motors, OMR"], [url("View vehicle"), reply("Book test drive")]),
  starter("motos_price_updated", "Price updated", "Share a price change on a vehicle.", "marketing",
    "Hi {{1}}, there's a price update on {{2}}.\n\nCurrent price: ₹{{3}}\n\nReply here to know more.",
    ["Rahul", "Honda City VX", "8,45,000"], [url("View vehicle")]),
  starter("motos_lead_followup", "Still interested?", "Re-engage a lead that went quiet.", "marketing",
    "Hi {{1}}, are you still interested in {{2}}?\n\nWe can help with pricing, test drives, exchange or finance.",
    ["Rahul", "the Honda City VX"], [reply("Talk to dealer")]),
  starter("motos_feedback", "Feedback request", "Ask for feedback after a purchase or service.", "marketing",
    "Hi {{1}}, thank you for choosing {{2}}.\n\nWe'd love to hear about your experience.",
    ["Rahul", "Tany Motors"], [reply("Share feedback")]),
];

/** Starter sets per product. Add a product here to give it a starter library. */
const starterLibrary: Partial<Record<TanyVertical, StarterTemplate[]>> = { retail, eats, motos };

export const startersFor = (vertical: TanyVertical) => starterLibrary[vertical] ?? [];
export function findStarter(vertical: TanyVertical, key: string) {
  return startersFor(vertical).find(starter => starter.key === key) ?? null;
}
