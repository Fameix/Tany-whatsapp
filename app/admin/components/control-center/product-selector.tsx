"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover } from "radix-ui";
import { BrandLogo } from "@/components/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSidebar } from "@/components/ui/sidebar";
import { tanyProducts } from "@/lib/messaging/vertical-config";
import { adminProductFromPath, adminProductPath } from "@/lib/admin/product-routes";
import type { TanyVertical } from "@/lib/messaging/types";

const allProducts = "All Products";

function ProductLabel({ name, product }: { name: string; product?: TanyVertical }) {
  return (
    <>
      <BrandLogo vertical={product} decorative />
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[11px] font-normal text-muted-foreground">Select product</span>
        <span className="block truncate text-sm font-medium">{name}</span>
      </span>
      <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </>
  );
}

const triggerClassName = "min-h-11 w-full justify-start gap-2.5 px-2 py-2";

export function AdminProductMenuLoading() {
  return (
    <Button type="button" variant="ghost" className={triggerClassName} disabled aria-busy="true">
      <ProductLabel name={allProducts} />
    </Button>
  );
}

/** Super Admin navigation depends only on the product registry and the URL. */
export function AdminProductMenu() {
  const router = useRouter();
  const selected = adminProductFromPath(usePathname());
  const { setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(false);
  const select = (id?: TanyVertical) => {
    setOpen(false);
    setOpenMobile(false);
    router.push(adminProductPath(id));
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" className={triggerClassName}
          aria-label={`Select product. Current: ${selected?.name ?? allProducts}`}>
          <ProductLabel name={selected?.name ?? allProducts} product={selected?.id} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content aria-label="Select product" align="start" sideOffset={4} collisionPadding={8}
          className="z-50 w-72 max-w-[var(--radix-popover-content-available-width)] rounded-xl border bg-popover shadow-lg">
          <Command label="Search products" filter={(name, search) => Number(name.toLowerCase().includes(search.trim().toLowerCase()))}>
            <CommandInput placeholder="Search products…" />
            <CommandList className="max-h-[min(24rem,calc(var(--radix-popover-content-available-height)-3rem))] p-1">
              <CommandEmpty>No matching products.</CommandEmpty>
              <CommandItem value={allProducts} data-checked={!selected} onSelect={() => select()} className="min-h-11 cursor-pointer">
                <BrandLogo decorative className="size-6" />
                <span className="flex-1 font-medium">{allProducts}</span>
              </CommandItem>
              {tanyProducts.map(item => (
                <CommandItem key={item.id} value={item.name} data-checked={selected?.id === item.id}
                  onSelect={() => select(item.id)} className="min-h-11 cursor-pointer">
                  <BrandLogo vertical={item.id} decorative className="size-6" />
                  <span className="flex-1 font-medium">{item.name}</span>
                  <Badge variant={item.status === "live" ? "secondary" : "outline"} className="shrink-0 text-[10px] font-normal">
                    {item.status === "live" ? "Live" : "Coming soon"}
                  </Badge>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
