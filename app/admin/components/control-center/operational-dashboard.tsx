import Link from "next/link";
import { Activity, Building2, ChevronRight, Megaphone, MessageCircle, Send, Users, Workflow } from "lucide-react";
import { cn } from "cn";
import { BrandLogo } from "@/components/brand-logo";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import { adminProductPath } from "@/lib/admin/product-routes";
import type { OperationalOverview, OverviewMetrics } from "@/lib/admin/operational-overview";
import { EmptyState, Initials, Panel, StatusDot, Surface } from "@/app/business/_components/home/home-primitives";
import { ProductStatus } from "./ui";

// Same visual language as a business's Home: soft cards, quiet icons, plain-language status.
const kpis = [
  ["businesses", "Active businesses", Building2],
  ["connected", "Connected WhatsApp", MessageCircle],
  ["conversations", "Conversations today", Activity],
  ["sent", "Messages sent today", Send],
  ["automations", "Active automations", Workflow],
  ["campaigns", "Campaigns running", Megaphone],
] as const;
const productKpis = [["businesses", "Businesses", Building2], kpis[1], kpis[2], ["customers", "Customers", Users], kpis[3], kpis[4]] as const;
const breakdownStats = [["businesses", "Businesses"], ["connected", "On WhatsApp"], ["conversations", "Conversations today"], ["automations", "Automations"]] as const;
const number = new Intl.NumberFormat("en-IN");
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const eventFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const percent = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });

export function OperationalMetrics({ data, product = false }: { data: OverviewMetrics; product?: boolean }) {
  return (
    <dl aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
      {(product ? productKpis : kpis).map(([key, label, Icon]) => (
        <Surface key={key} className="min-w-0 p-4">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <Icon aria-hidden="true" className="size-4 text-muted-foreground/70" />
          </div>
          <dd className="mt-2 text-[28px] font-semibold leading-8 tracking-tight tabular-nums">{number.format(data[key])}</dd>
        </Surface>
      ))}
    </dl>
  );
}

export function MessagingActivity({ days, title = "Conversations activity" }: { days: OperationalOverview["days"]; title?: string }) {
  if (!days.some(day => day.incoming || day.outgoing || day.conversations))
    return <Panel title={title} description="Last 7 days"><EmptyState title="No activity this week" description="Messages and conversations from the last 7 days show up here." /></Panel>;
  const max = Math.max(1, ...days.map(day => day.incoming + day.outgoing));
  return (
    <Panel title={title} description="Last 7 days">
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground sm:px-0">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Incoming</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sky-400" />Outgoing</span>
      </div>
      <figure className="mt-4 px-2 sm:px-0">
        <figcaption className="sr-only">Daily incoming and outgoing messages. Counts under each day show active conversations.</figcaption>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((day, index) => {
            const label = index === days.length - 1 ? "Today" : dateFormat.format(new Date(day.date));
            return (
              <div key={day.date} role="img" className="min-w-0 text-center" aria-label={`${label}, ${day.incoming} incoming messages, ${day.outgoing} outgoing messages, ${day.conversations} conversations`}>
                <div aria-hidden="true" className="flex h-24 flex-col-reverse items-center border-b border-border/70">
                  <div className="w-1/2 max-w-7 bg-primary" style={{ height: `${day.incoming / max * 100}%` }} />
                  <div className="w-1/2 max-w-7 rounded-t-sm bg-sky-400" style={{ height: `${day.outgoing / max * 100}%` }} />
                </div>
                <span aria-hidden="true" className="mt-2 block text-[11px] leading-4 text-muted-foreground">{label}</span>
                <span aria-hidden="true" className="block text-xs font-semibold tabular-nums">{number.format(day.conversations)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Conversations per day</p>
      </figure>
    </Panel>
  );
}

export function MessagingHealth({ data }: { data: OperationalOverview["health"] }) {
  const outcomes = data.delivered + data.read + data.failed + data.sent;
  const rate = outcomes ? data.failed / outcomes : 0;
  const state = !outcomes ? { tone: "neutral" as const, title: "No messages sent today", detail: "Delivery results appear here once messages go out." }
    : rate > 0.05 ? { tone: "warning" as const, title: "Some messages are failing", detail: `${percent.format(rate)} of today's messages failed to deliver.` }
      : { tone: "success" as const, title: "Messaging is healthy", detail: data.failed ? `${percent.format(rate)} failed today.` : "No failed messages today." };
  return (
    <Panel title="Messaging health" description="Messages sent today">
      <div className="flex items-start gap-3 px-2 py-2 sm:px-0">
        <span className="mt-1.5"><StatusDot tone={state.tone} /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{state.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{state.detail}</p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 px-2 sm:px-0">
        {([["Delivered", data.delivered + data.read], ["Read", data.read], ["Failed", data.failed]] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("mt-0.5 text-base font-semibold tabular-nums", label === "Failed" && value ? "text-primary" : "")}>{number.format(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 px-2 text-xs text-muted-foreground sm:px-0">{number.format(data.sent)} sent · {number.format(data.pending)} pending · {number.format(data.unknown)} without a status yet</p>
    </Panel>
  );
}

function Breakdown({ items }: { items: OperationalOverview["breakdown"] }) {
  return (
    <section aria-labelledby="live-products" className="flex flex-col gap-4">
      <h2 id="live-products" className="text-sm font-semibold tracking-tight">Live products</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ product, metrics }) => (
          <Link key={product} href={adminProductPath(product)} className="group block rounded-xl focus-visible:outline-offset-2">
            <Surface className="flex h-full flex-col gap-4 p-4 transition-shadow group-hover:shadow-[0_2px_8px_rgb(9_9_11/0.06),0_0_0_1px_rgb(9_9_11/0.08)]">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-3"><BrandLogo vertical={product} decorative /><span className="truncate text-sm font-semibold">{verticalConfig[product].label}</span></span>
                <ProductStatus status="live" />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {breakdownStats.map(([key, label]) => <div key={key}><dt className="text-muted-foreground">{label}</dt><dd className="text-base font-semibold tabular-nums">{number.format(metrics[key])}</dd></div>)}
              </dl>
              <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">Open product<ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
            </Surface>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function BusinessAttention({ items }: { items: OperationalOverview["attention"] }) {
  return (
    <Panel title="Needs attention" description="Businesses with a connection issue or failed messages today">
      {items.length ? (
        <ul className="flex flex-col">
          {items.map(business => {
            const reasons = [
              business.disconnected && "WhatsApp disconnected",
              business.setup && "WhatsApp setup not finished",
              business.failures > 0 && `${business.failures} failed ${business.failures === 1 ? "message" : "messages"}`,
              business.webhookFailures > 0 && `${business.webhookFailures} delivery ${business.webhookFailures === 1 ? "problem" : "problems"}`,
            ].filter(Boolean);
            return (
              <li key={business.id}>
                <Link href={`/business/${encodeURIComponent(business.id)}`} className="group flex items-center gap-4 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                  <Initials name={business.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{business.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{reasons.join(" · ")}</span>
                  </span>
                  <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground group-hover:bg-background group-hover:text-foreground">Open</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState title="Everything looks good" description="Businesses with a WhatsApp or delivery problem will appear here." />}
    </Panel>
  );
}

export function RecentActivity({ items }: { items: OperationalOverview["activity"] }) {
  return (
    <Panel title="Recent activity" description="Last 7 days">
      {items.length ? (
        <ul className="flex flex-col">
          {items.map((event, index) => (
            <li key={`${event.id}:${event.at}:${event.event}:${index}`} className="flex items-center gap-4 rounded-lg px-2 py-2">
              <Initials name={event.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{event.event}</span>
                <span className="block truncate text-xs text-muted-foreground">{event.name}</span>
              </span>
              <time dateTime={event.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">{eventFormat.format(new Date(event.at))}</time>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No recent activity" description="New connections and messaging events appear here." />}
    </Panel>
  );
}

export function OperationalDashboard({ data }: { data: OperationalOverview }) {
  return (
    <>
      <OperationalMetrics data={data.metrics} />
      <Breakdown items={data.breakdown} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <BusinessAttention items={data.attention} />
          <MessagingActivity days={data.days} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <MessagingHealth data={data.health} />
          <RecentActivity items={data.activity} />
        </div>
      </div>
      <Link href="/admin/system" className="w-fit rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline">View test, demo and migration businesses in Test &amp; Staging</Link>
    </>
  );
}
