import type { TanyProduct, ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { adminProductPath } from "./product-routes";

const sections = {
  overview: "Overview",
  dealers: "Dealers",
  leads: "Leads",
  vehicles: "Vehicles",
  "test-drives": "Test Drives",
  restaurants: "Restaurants",
  orders: "Orders",
  delivery: "Delivery",
  stores: "Stores",
  products: "Products",
  customers: "Customers",
  inbox: "Inbox",
  templates: "Templates",
  automations: "Automations",
  campaigns: "Campaigns",
  whatsapp: "WhatsApp",
  "message-status": "Message Status",
  "webhook-health": "Webhook Health",
  settings: "Settings",
} as const;

export type ProductSection = keyof typeof sections;

const messaging = ["inbox", "templates", "automations", "campaigns"] as const;
const primary = {
  motos: ["overview", "dealers", "leads", "vehicles", "test-drives", "customers", ...messaging],
  eats: ["overview", "restaurants", "orders", "customers", "delivery", ...messaging],
  retail: ["overview", "stores", "orders", "products", "customers", ...messaging],
} as const satisfies Record<ActiveTanyVertical, readonly ProductSection[]>;

export function productNavigation(product: TanyProduct) {
  const id = product.id;
  const root = adminProductPath(id);
  const link = (section: ProductSection) => ({
    label: sections[section],
    section,
    href: section === "overview" ? root : `${root}/${section}`,
  });
  const live = isActiveTanyVertical(id);
  const groups: { label?: string; links: ReturnType<typeof link>[] }[] = [
    { links: (live ? primary[id] : ["overview"] as const).map(link) },
  ];
  if (live) groups.push({ label: "Operations", links: (["whatsapp", "message-status", "webhook-health"] as const).map(link) });
  groups.push({ label: "System", links: [link("settings")] });
  return groups;
}
