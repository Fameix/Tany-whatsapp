/* eslint-disable @typescript-eslint/no-require-imports */
const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const businessId = "demo-retail";
const templates = {
  retail_welcome: ["Welcome", "Welcome to {{business_name}}, {{customer_name}}. Shop products, track an order, view offers, or get support."],
  order_received: ["Order received", "Hi {{customer_name}}, we received order {{order_id}} for {{amount}}."],
  payment_received: ["Payment received", "Payment for order {{order_id}} has been received. Amount: {{amount}}."],
  order_preparing: ["Order preparing", "Order {{order_id}} is being prepared."],
  order_packed: ["Order packed", "Order {{order_id}} is packed and will be dispatched soon."],
  ready_for_pickup: ["Ready for pickup", "Order {{order_id}} is ready for pickup at {{business_name}}."],
  out_for_delivery: ["Out for delivery", "Order {{order_id}} is out for delivery. Current status: {{status}}."],
  order_delivered: ["Order delivered", "Order {{order_id}} has been delivered. Thank you, {{customer_name}}."],
  order_cancelled: ["Order cancelled", "Order {{order_id}} has been cancelled. Current status: {{status}}."],
  refund_update: ["Refund update", "Refund update for order {{order_id}}: {{status}}. Amount: {{amount}}."],
  abandoned_cart: ["Abandoned cart", "Hi {{customer_name}}, your cart at {{business_name}} is waiting for you."],
  support_followup: ["Support follow-up", "Hi {{customer_name}}, we are following up on your support request for order {{order_id}}."],
};

async function main() {
  const app = getApps().find((candidate) => candidate.name === "tany-messaging-retail-template-seed") ??
    initializeApp({ credential: applicationDefault(), projectId: "tany-whatsapp" }, "tany-messaging-retail-template-seed");
  const db = getFirestore(app);
  const business = await db.collection("businesses").doc(businessId).get();
  if (!business.exists || business.data()?.vertical !== "retail" || business.data()?.active !== true)
    throw new Error("Active Demo Retail business is required before seeding templates.");
  let created = 0;
  await db.runTransaction(async (tx) => {
    const entries = Object.entries(templates).map(([id, value]) => ({ id, value, ref: db.collection("templates").doc(id) }));
    const snapshots = await Promise.all(entries.map(({ ref }) => tx.get(ref)));
    for (const [{ value: [name, body], ref }, snapshot] of entries.map((entry, index) => [entry, snapshots[index]])) {
      if (snapshot.exists) continue;
      tx.create(ref, { businessId, name, language: "en", category: "utility", status: "draft", body, variables: ["business_name", "customer_name", "order_id", "amount", "status"], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      created++;
    }
  });
  console.log(JSON.stringify({ businessId, created, total: Object.keys(templates).length }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
