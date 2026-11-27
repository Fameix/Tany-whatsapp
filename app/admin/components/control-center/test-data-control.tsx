"use client";

import { useFormStatus } from "react-dom";
import { FlaskConical } from "lucide-react";
import { setIncludeTestData } from "@/app/admin/product-test-data-actions";

function Toggle({ included }: { included: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" role="switch" aria-checked={included} disabled={pending}
    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
    Include test data
    <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 ${included ? "justify-end bg-primary" : "bg-muted-foreground/60"}`}>
      <span className="size-4 rounded-full bg-white" />
    </span>
  </button>;
}

export function TestDataControl({ included }: { included: boolean }) {
  return <form action={setIncludeTestData} className="mb-4 flex flex-wrap items-center justify-between gap-x-3 rounded-lg border bg-card px-3 py-1">
    <input type="hidden" name="includeTestData" value={included ? "off" : "on"} />
    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
      <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <span role="status">{included ? "Test data included" : "Live businesses only"}</span>
    </div>
    <Toggle included={included} />
  </form>;
}
