import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { HomeConnection } from "@/lib/dashboard/business-home";
import { StatusDot, Surface } from "./home-primitives";

const labels: Record<HomeConnection["state"], { title: string; tone: "success" | "warning" | "neutral"; cta?: string }> = {
  connected: { title: "WhatsApp connected", tone: "success" },
  attention: { title: "WhatsApp needs attention", tone: "warning", cta: "Review" },
  setup: { title: "WhatsApp setup in progress", tone: "warning", cta: "Continue setup" },
  not_connected: { title: "WhatsApp not connected", tone: "neutral", cta: "Connect" },
  inactive: { title: "Business inactive", tone: "neutral" },
};

/** Compact, glanceable connection state for the Home header. */
export function ConnectionStatus({ connection, href }: { connection: HomeConnection; href: string }) {
  const { title, tone, cta } = labels[connection.state];
  const identity = [connection.displayName, connection.displayPhone].filter(Boolean).join(" · ");
  return (
    <Link href={href} className="group block rounded-xl focus-visible:outline-offset-2" aria-label={`${title}${identity ? `, ${identity}` : ""}. Manage WhatsApp`}>
      <Surface className="flex items-center gap-4 px-4 py-2 transition-shadow group-hover:shadow-[0_2px_8px_rgb(9_9_11/0.06),0_0_0_1px_rgb(9_9_11/0.08)]">
        <StatusDot tone={tone} />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-5">{title}</p>
          <p className="truncate text-xs leading-5 text-muted-foreground tabular-nums">{identity || (connection.state === "inactive" ? "Activate this business to resume messaging" : "Connect a WhatsApp Business number to start")}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {cta ?? "Manage"}
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </span>
      </Surface>
    </Link>
  );
}
