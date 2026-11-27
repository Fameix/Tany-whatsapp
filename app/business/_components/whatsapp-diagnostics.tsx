import Link from "next/link";
import { Activity, CheckCheck, ChevronRight, Smartphone, Store, type LucideIcon } from "lucide-react";
import { Surface } from "./home/home-primitives";
import { workspaceRoot } from "@/lib/admin/workspace-root";

/** Settings → WhatsApp → Business Profile. */
export async function WhatsAppProfileLink({ businessId }: { businessId: string }) {
  return (
    <Surface className="overflow-hidden">
      <Link href={`${await workspaceRoot(businessId)}/whatsapp/profile`} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
        <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Business profile</span>
          <span className="block truncate text-xs text-muted-foreground">Profile picture, about, description, contact details and websites</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </Surface>
  );
}

/** Technical WhatsApp pages, kept off primary navigation (Settings → WhatsApp → Diagnostics). */
export async function WhatsAppDiagnostics({ businessId }: { businessId: string }) {
  const root = await workspaceRoot(businessId);
  const items: Array<{ label: string; description: string; href: string; icon: LucideIcon }> = [
    { label: "Message status", description: "Delivery and read status of recent messages", href: `${root}/message-status`, icon: CheckCheck },
    { label: "Webhook health", description: "Whether WhatsApp messages are reaching Tany", href: `${root}/webhook-health`, icon: Activity },
    { label: "WhatsApp account", description: "Number, business account and connection details", href: `${root}/whatsapp-accounts`, icon: Smartphone },
  ];
  return (
    <section aria-labelledby="whatsapp-diagnostics" className="flex flex-col gap-2">
      <div>
        <h2 id="whatsapp-diagnostics" className="text-sm font-semibold tracking-tight">WhatsApp diagnostics</h2>
        <p className="mt-1 text-xs text-muted-foreground">Troubleshooting details for when messages are not arriving or being delivered.</p>
      </div>
      <Surface className="overflow-hidden">
        <ul className="divide-y divide-border/60">
          {items.map(({ label, description, href, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Surface>
    </section>
  );
}
