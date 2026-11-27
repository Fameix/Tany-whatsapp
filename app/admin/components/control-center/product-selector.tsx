"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { tanyProducts } from "@/lib/messaging/vertical-config";

export function ProductSelector({ product }: { product: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState(product);
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex w-full shrink-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground sm:w-48">
      Product
      <select name="product" value={selected} aria-busy={pending}
        onChange={event => {
          const value = event.target.value;
          setSelected(value);
          startTransition(() => router.push(value ? `/admin?product=${encodeURIComponent(value)}` : "/admin", { scroll: false }));
        }}
        className="min-h-11 w-full cursor-pointer rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <option value="">All Products</option>
        {tanyProducts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <span className="sr-only" role="status">{pending ? "Updating dashboard" : ""}</span>
    </label>
  );
}
