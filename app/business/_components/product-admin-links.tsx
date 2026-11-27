import Link from "next/link";
import { ChevronRight, FlaskConical, type LucideIcon } from "lucide-react";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import type { ProductTestProduct } from "@/lib/admin/product-test-tenants";
import { Surface } from "./home/home-primitives";

/** Settings → <product> administration. Only shown inside a Super Admin product workspace, where
 * the workspace replaces the product pages; these are the Super Admin pages that remain. */
export function ProductAdminLinks({ product }: { product: ProductTestProduct }) {
  const name = verticalConfig[product].label;
  const items: Array<{ label: string; description: string; href: string; icon: LucideIcon }> = [
    { label: "Test & staging", description: `Test data and staging tools for ${name}`, href: `/admin/system?product=${product}`, icon: FlaskConical },
  ];
  return (
    <section aria-labelledby="product-admin" className="mt-6 flex flex-col gap-2">
      <div>
        <h2 id="product-admin" className="text-sm font-semibold tracking-tight">{name} administration</h2>
        <p className="mt-1 text-xs text-muted-foreground">Test data and staging tools.</p>
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
