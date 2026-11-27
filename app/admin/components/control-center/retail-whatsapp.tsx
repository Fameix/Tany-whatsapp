import BusinessLayout from "@/app/business/[businessId]/layout";
import BusinessWhatsAppPage from "@/app/business/[businessId]/whatsapp/page";
import { retailWhatsAppBusinessId } from "@/lib/admin/retail-whatsapp-route";

export { retailWhatsAppBusinessId };

/** Renders /business/test-retail/whatsapp exactly: the real business layout (sidebar,
 * header, access checks) around the real WhatsApp page, with the same actions and links. */
export function RetailWhatsApp() {
  const params = Promise.resolve({ businessId: retailWhatsAppBusinessId });
  return (
    <BusinessLayout params={params}>
      <BusinessWhatsAppPage params={params} />
    </BusinessLayout>
  );
}
