import type { TanyVertical } from "@/lib/messaging/types";
import { tanyProducts } from "@/lib/messaging/vertical-config";

export const stagingBootstrapAttemptParam = "_staging_session";

export function adminProductPath(product?: TanyVertical) {
  return product ? `/admin/products/${product}` : "/admin";
}

export function adminProductFromPath(pathname: string) {
  const id = /^\/admin\/products\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  return tanyProducts.find(product => product.id === id);
}
