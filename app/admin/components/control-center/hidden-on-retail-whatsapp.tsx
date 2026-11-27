"use client";

import { usePathname } from "next/navigation";
import { retailWhatsAppAdminPath } from "@/lib/admin/retail-whatsapp-route";

/** Hides Super Admin product chrome on Tany Retail WhatsApp, which shows test-retail's own page. */
export function HiddenOnRetailWhatsApp({ children }: { children: React.ReactNode }) {
  return usePathname() === retailWhatsAppAdminPath ? null : <>{children}</>;
}
