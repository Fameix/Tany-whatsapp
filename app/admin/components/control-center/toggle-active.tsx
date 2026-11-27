"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { toggleBusinessAction } from "@/app/admin/actions";
import { initialActionState } from "@/app/admin/components/shared";

/** Activate or deactivate a tenant through the existing Super Admin action. Nothing is deleted. */
export function ToggleActive({ businessId, active, name }: { businessId: string; active: boolean; name: string }) {
  const [state, action, pending] = useActionState(toggleBusinessAction.bind(null, businessId, !active), initialActionState);
  return (
    <form action={action} className="inline-flex flex-col items-end">
      <button type="submit" disabled={pending} aria-label={`${active ? "Deactivate" : "Activate"} ${name}`}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60">
        {pending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
        {active ? "Deactivate" : "Activate"}
      </button>
      {state.message && !state.ok && <span role="alert" className="max-w-40 text-[11px] text-primary">{state.message}</span>}
    </form>
  );
}
