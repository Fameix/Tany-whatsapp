import type { TanyProduct, ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { isActiveTanyVertical } from "@/lib/messaging/vertical-config";
import { adminProductPath } from "./product-routes";

const sections = {
  overview: "Overview",
  dealers: "Dealers",
  restaurants: "Restaurants",
  stores: "Stores",
  whatsapp: "WhatsApp",
  "message-status": "Message Status",
  "webhook-health": "Webhook Health",
  staging: "Test & Staging",
  settings: "Settings",
} as const;

export type ProductSection = keyof typeof sections;
const directory = { motos: "dealers", eats: "restaurants", retail: "stores" } as const;
const workspaceSections = new Set([
  "inbox", "customers", "contacts", "templates", "automations", "campaigns",
  "orders", "delivery", "test-drives", "leads", "vehicles", "products",
]);

export function productWorkspaceRedirect(product: ActiveTanyVertical, section: string) {
  return workspaceSections.has(section) ? adminProductPath(product) + "/" + directory[product] : null;
}

export function productNavigation(product: TanyProduct) {
  const id = product.id;
  const root = adminProductPath(id);
  const link = (section: ProductSection) => ({
    label: sections[section],
    section,
    href: section === "overview" ? root : section === "staging" ? "/admin/system?product=" + id : root + "/" + section,
  });
  const live = isActiveTanyVertical(id);
  const groups: { label?: string; links: ReturnType<typeof link>[] }[] = [
    { links: live ? [link("overview"), link(directory[id])] : [link("overview")] },
  ];
  if (live) groups.push({ label: "Health", links: (["whatsapp", "message-status", "webhook-health"] as const).map(link) });
  groups.push({ label: "System", links: live ? [link("staging"), link("settings")] : [link("settings")] });
  return groups;
}
