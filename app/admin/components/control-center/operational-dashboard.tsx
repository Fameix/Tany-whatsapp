import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, ArrowUpRight, Building2, Megaphone, MessageCircle, Send, Workflow } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { verticalConfig } from "@/lib/messaging/vertical-config";
import type { OperationalOverview, OverviewMetrics } from "@/lib/admin/operational-overview";
import { surface } from "./ui";

const kpis = [
  ["businesses", "Active businesses", Building2],
  ["connected", "Connected WhatsApp", MessageCircle],
  ["conversations", "Conversations today", Activity],
  ["sent", "Messages sent today", Send],
  ["automations", "Active automations", Workflow],
  ["campaigns", "Campaigns running", Megaphone],
] as const;
const breakdownColumns = [kpis[0], kpis[1], kpis[2], kpis[4]] as const;
const number = new Intl.NumberFormat("en-IN");
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const eventFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
const percent = new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 });

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={`${surface} min-w-0 p-4 sm:p-5`}>
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-4 rounded-lg bg-muted/50 px-3 py-4 text-sm text-muted-foreground">{children}</p>;
}

function Metrics({ data }: { data: OverviewMetrics }) {
  return (
    <dl aria-label="Key metrics" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map(([key, label, Icon]) => (
        <div key={key} className={`${surface} flex min-w-0 flex-col gap-1.5 px-3 py-3 sm:px-4`}>
          <Icon aria-hidden="true" className="size-4 text-primary" />
          <dt className="text-xs font-medium leading-4 text-muted-foreground">{label}</dt>
          <dd className="text-2xl font-semibold leading-7 tracking-tight tabular-nums">{number.format(data[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function Conversations({ days }: { days: OperationalOverview["days"] }) {
  if (!days.some(day => day.incoming || day.outgoing || day.conversations)) {
    return (
      <Panel title="Conversations activity" subtitle="Last 7 days · India time">
        <Empty>No conversation or message activity in the last 7 days.</Empty>
      </Panel>
    );
  }
  const max = Math.max(1, ...days.map(day => day.incoming + day.outgoing));
  return (
    <Panel title="Conversations activity" subtitle="Last 7 days · India time">
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary" />Incoming messages</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-sky-400" />Outgoing messages</span>
      </div>
      <figure className="mt-4">
        <figcaption className="sr-only">Daily incoming and outgoing messages. Counts under each day show active conversations.</figcaption>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((day, index) => {
            const label = index === days.length - 1 ? "Today" : dateFormat.format(new Date(day.date));
            return (
              <div key={day.date} role="img" className="min-w-0 text-center"
                aria-label={`${label}, ${day.incoming} incoming messages, ${day.outgoing} outgoing messages, ${day.conversations} conversations`}>
                <div aria-hidden="true" className="flex h-24 flex-col-reverse items-center border-b border-border/70" title={`${day.incoming} incoming · ${day.outgoing} outgoing`}>
                  <div className="w-1/2 max-w-7 bg-primary" style={{ height: `${day.incoming / max * 100}%` }} />
                  <div className="w-1/2 max-w-7 rounded-t-sm bg-sky-400" style={{ height: `${day.outgoing / max * 100}%` }} />
                </div>
                <span aria-hidden="true" className="mt-2 block text-[11px] leading-4 text-muted-foreground">{label}</span>
                <span aria-hidden="true" className="block text-xs font-semibold tabular-nums">{number.format(day.conversations)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Active conversations per day</p>
      </figure>
    </Panel>
  );
}

function Health({ data }: { data: OperationalOverview["health"] }) {
  const statuses = [
    ["Delivered", data.delivered], ["Read", data.read], ["Failed", data.failed],
    ["Pending", data.pending], ["Sent", data.sent], ["Unknown", data.unknown],
  ] as const;
  const outcomes = data.delivered + data.read + data.failed + data.sent;
  return (
    <Panel title="Messaging health" subtitle="Outgoing messages today · Latest known status">
      <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
        <span className="text-xs font-medium">Failure rate</span>
        <span className={`text-lg font-semibold tabular-nums ${data.failed ? "text-destructive" : ""}`}>
          {outcomes ? percent.format(data.failed / outcomes) : "—"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{outcomes ? "Among messages with a recorded send or delivery outcome." : "No send or delivery outcomes recorded today."}</p>
      <dl className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2">
        {statuses.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`mt-0.5 text-base font-semibold tabular-nums ${label === "Failed" && value ? "text-destructive" : ""}`}>{number.format(value)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Breakdown({ items }: { items: OperationalOverview["breakdown"] }) {
  return (
    <Panel title="Product breakdown" subtitle="Live products">
      <div className="mt-3 hidden sm:block">
        <table className="w-full table-fixed text-left text-xs">
          <thead className="text-muted-foreground">
            <tr><th scope="col" className="w-[30%] py-2 font-medium">Product</th>{breakdownColumns.map(([key, label]) => <th key={key} scope="col" className="px-1 py-2 text-right font-medium">{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map(({ product, metrics }) => (
              <tr key={product} className="border-t border-border/60">
                <th scope="row" className="py-2 font-medium">
                  <Link href={`/admin?product=${product}`} className="inline-flex min-h-10 items-center gap-2 rounded-sm hover:underline">
                    <BrandLogo vertical={product} decorative />{verticalConfig[product].label}
                  </Link>
                </th>
                {breakdownColumns.map(([key]) => <td key={key} className="px-1 text-right tabular-nums">{number.format(metrics[key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 divide-y divide-border/60 sm:hidden">
        {items.map(({ product, metrics }) => (
          <li key={product} className="py-2">
            <Link href={`/admin?product=${product}`} className="flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium hover:underline">
              <BrandLogo vertical={product} decorative />{verticalConfig[product].label}
            </Link>
            <dl className="grid grid-cols-2 gap-2 pb-1 text-xs">
              {breakdownColumns.map(([key, label]) => <div key={key}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{number.format(metrics[key])}</dd></div>)}
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function OperationalDashboard({ data, allProducts }: { data: OperationalOverview; allProducts: boolean }) {
  return (
    <>
      <Metrics data={data.metrics} />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Conversations days={data.days} />
        <Health data={data.health} />
        <Panel title="Business attention" subtitle="Connection issues and failures recorded today">
          {data.attention.length ? <ul className="mt-2 divide-y divide-border/60">
            {data.attention.map(business => {
              const reasons = [
                business.disconnected && "WhatsApp disconnected or in error",
                business.setup && "WhatsApp setup incomplete",
                business.failures > 0 && `${business.failures} message ${business.failures === 1 ? "failure" : "failures"}`,
                business.webhookFailures > 0 && `${business.webhookFailures} webhook ${business.webhookFailures === 1 ? "failure" : "failures"}`,
              ].filter(Boolean);
              return <li key={business.id}>
                <Link href={`/business/${encodeURIComponent(business.id)}`} className="flex min-h-11 items-center justify-between gap-2 rounded-sm py-2 hover:text-primary">
                  <span className="min-w-0"><span className="block break-words text-sm font-medium">{business.name}</span><span className="block text-xs text-muted-foreground">{reasons.join(" · ")}</span></span>
                  <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>;
            })}
          </ul> : <Empty>No businesses have a recorded issue in this view.</Empty>}
        </Panel>
        <Panel title="Recent activity" subtitle="Last 7 days · India time">
          {data.activity.length ? <ul className="mt-2 divide-y divide-border/60">
            {data.activity.map((event, index) => <li key={`${event.id}:${event.at}:${event.event}:${index}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0"><p className="text-sm font-medium">{event.event}</p><p className="break-words text-xs text-muted-foreground">{event.name}</p></div>
              <time dateTime={event.at} className="text-xs text-muted-foreground">{eventFormat.format(new Date(event.at))}</time>
            </li>)}
          </ul> : <Empty>No recent operational activity in this view.</Empty>}
        </Panel>
      </div>
      {allProducts && <Breakdown items={data.breakdown} />}
      <Link href="/admin/system" className="w-fit rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline">View test, demo and migration businesses in Test &amp; Staging</Link>
    </>
  );
}
