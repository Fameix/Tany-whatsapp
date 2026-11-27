"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function WhatsAppBusinessSelector({ root, businessId, businesses }: {
  root: string; businessId: string; businesses: { id: string; name: string }[];
}) {
  const router = useRouter();
  return <label className="flex w-full max-w-sm flex-col gap-1.5 text-sm font-medium">
    Business
    <select value={businessId} onChange={event => router.push(`${root}?business=${encodeURIComponent(event.target.value)}`)}
      className="min-h-11 w-full rounded-lg border border-input bg-card px-3">
      {businesses.map(business => <option key={business.id} value={business.id}>{business.name}</option>)}
    </select>
  </label>;
}

export function RefreshWhatsAppStatus() {
  const router = useRouter();
  return <Button variant="outline" onClick={() => router.refresh()}>Refresh status</Button>;
}
