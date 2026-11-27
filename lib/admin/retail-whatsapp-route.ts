/** For now, Super Admin → Tany Retail → WhatsApp is test-retail's own WhatsApp page:
 * the same business layout, sidebar and page, shown at this Super Admin URL. */
export const retailWhatsAppBusinessId = "test-retail";
export const retailWhatsAppAdminPath = "/admin/products/retail/whatsapp";
export const retailWhatsAppBusinessPath = `/business/${retailWhatsAppBusinessId}/whatsapp`;

/** The business path a Super Admin alias stands for, so the business sidebar and
 * breadcrumb behave exactly as on the business route. */
export const workspacePathFor = (pathname: string) => (pathname === retailWhatsAppAdminPath ? retailWhatsAppBusinessPath : pathname);
