"use client";

import { useState, useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { verticalConfig, type ActiveTanyVertical } from "@/lib/messaging/vertical-config";
import type { AdminBusiness } from "@/lib/admin/types";
import { switchWorkspaceProduct } from "@/app/business/_components/workspace-product-action";

export function WorkspaceMenu({ business, product, products }: {
  business: Pick<AdminBusiness, "id" | "name" | "vertical" | "active">;
  product: ActiveTanyVertical | null;
  products: ActiveTanyVertical[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const { setOpenMobile } = useSidebar();
  const vertical = product ?? business.vertical;
  const productName = verticalConfig[vertical].label;
  const label = <>
    <BrandLogo vertical={vertical} decorative />
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-xs font-medium">{business.name}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{productName}{!business.active && " ? Inactive"}</span>
    </span>
  </>;
  const triggerClass = "flex min-h-11 w-full items-center justify-start gap-3 px-2 py-2";
  if (products.length < 2) return <div className={triggerClass}>{label}</div>;

  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={triggerClass} disabled={pending} aria-label={"Switch product. Current: " + productName}>
          {label}<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Switch product</DropdownMenuLabel>
        {products.map(option => (
          <DropdownMenuItem key={option} className="min-h-10" aria-current={product === option ? "true" : undefined}
            onSelect={() => {
              setOpenMobile(false);
              if (product === option) return;
              setError(false);
              startTransition(async () => {
                if (!(await switchWorkspaceProduct(business.id, option))) setError(true);
              });
            }}>
            <BrandLogo vertical={option} decorative />
            <span className="flex-1">{verticalConfig[option].label}</span>
            {product === option && <Check aria-label="Current product" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <p role="alert" className="px-2 pb-1 text-xs text-destructive">That product is unavailable.</p>}
  </>;
}
