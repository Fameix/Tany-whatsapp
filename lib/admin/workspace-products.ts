import { isActiveTanyVertical, type ActiveTanyVertical } from "@/lib/messaging/vertical-config";

/** Legacy tenants without an explicit purchase list use their configured product. */
export function purchasedWorkspaceProducts(primary: unknown, products: unknown): ActiveTanyVertical[] {
  if (!isActiveTanyVertical(primary)) return [];
  const purchased = Array.isArray(products) ? products.filter((value): value is string => typeof value === "string") : [];
  return purchased.length ? [...new Set(purchased.filter(isActiveTanyVertical))] : [primary];
}

const workspaceModules = {
  retail: [{ section: "products", label: "Products" }, { section: "orders", label: "Orders" }],
  eats: [{ section: "menu", label: "Menu" }, { section: "orders", label: "Orders" }, { section: "delivery", label: "Delivery" }],
  motos: [{ section: "vehicles", label: "Vehicles" }, { section: "leads", label: "Leads" }, { section: "test-drives", label: "Test Drives" }],
} as const satisfies Record<ActiveTanyVertical, readonly { section: string; label: string }[]>;

export type WorkspaceProductModule = (typeof workspaceModules)[ActiveTanyVertical][number];

export function workspaceProductModules(product: ActiveTanyVertical | null): readonly WorkspaceProductModule[] {
  return product ? workspaceModules[product] : [];
}

export function selectWorkspaceProduct(
  products: readonly ActiveTanyVertical[], primary: string, preference?: string,
): ActiveTanyVertical | null {
  return products.find(product => product === preference) ??
    products.find(product => product === primary) ?? products[0] ?? null;
}

const motoEnquiryStates = new Set([
  "motos_showing_results", "motos_vehicle_selected", "motos_awaiting_testdrive_date",
  "motos_awaiting_testdrive_time", "motos_awaiting_confirmation",
]);

export function matchesWorkspaceModule(
  section: WorkspaceProductModule["section"],
  product: ActiveTanyVertical | null,
  primary: string,
  record: Record<string, unknown>,
) {
  // Older records without a vertical belong to the business's original product.
  if ((record.vertical ?? primary) !== product) return false;
  if (section === "delivery") return record.status === "out_for_delivery" || record.status === "delivered";
  if (section === "test-drives") return record.serviceId === "test_drive";
  if (section === "leads") return typeof record.state === "string" && motoEnquiryStates.has(record.state);
  return true;
}
