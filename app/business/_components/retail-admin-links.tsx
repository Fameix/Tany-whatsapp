import Link from "next/link";
import { ChevronRight, FlaskConical, Store, type LucideIcon } from "lucide-react";
import { retailWorkspaceAdminRoot } from "@/lib/admin/retail-workspace";
import { Surface } from "./home/home-primitives";

/** Settings → Tany Retail administration. Only shown inside Super Admin → Tany Retail, where the
 * workspace replaces the product pages; these are the Super Admin pages that remain. */
export function RetailAdminLinks() {
  const items: Array<{ label: string; description: string; href: string; icon: LucideIcon }> = [
    { label: "All retail stores", description: "Every Tany Retail business workspace", href: `${retailWorkspaceAdminRoot}/stores`, icon: Store },
    { label: "Test & staging", description: "Test data and staging tools for Tany Retail", href: "/admin/system?product=retail", icon: FlaskConical },
  ];
  return (
    <section aria-labelledby="retail-admin" className="mt-6 flex flex-col gap-2">
      <div>
        <h2 id="retail-admin" className="text-sm font-semibold tracking-tight">Tany Retail administration</h2>
        <p className="mt-1 text-xs text-muted-foreground">Pages for every Tany Retail business.</p>
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
