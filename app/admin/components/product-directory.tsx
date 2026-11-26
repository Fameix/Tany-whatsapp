import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { isActiveTanyVertical, verticalConfig } from "@/lib/messaging/vertical-config";

export function ProductDirectory() {
  return <main className="space-y-6">
    <header><p className="text-sm font-medium text-primary">Tany products</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Choose a product</h1><p className="mt-2 text-sm text-muted-foreground">Tany Motos, Tany Eats, and Tany Retail are active. The remaining products are being prepared.</p></header>
    <section aria-label="Tany product directory" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Object.values(verticalConfig).map((product) => {
        const active = isActiveTanyVertical(product.key);
        return <Card key={product.key} className="gap-4 p-5 shadow-none">
          <div className="flex items-start justify-between gap-3"><BrandLogo vertical={product.key} decorative /><Badge variant={active ? "secondary" : "outline"} className="gap-1 rounded-md font-normal">{active ? <CheckCircle2 className="size-3.5" /> : <Clock3 className="size-3.5" />}{active ? "Active" : "Coming Soon"}</Badge></div>
          <div><h2 className="text-base font-semibold">{product.label}</h2><p className="mt-1 text-sm text-muted-foreground">{active ? "Open the product workspace to manage its customer experience." : "This product is not active yet."}</p></div>
          {active ? <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/admin/products/${product.key}`}>Open workspace <ArrowUpRight className="size-4" /></Link> : <span className="text-sm text-muted-foreground">Not available</span>}
        </Card>;
      })}
    </section>
  </main>;
}
