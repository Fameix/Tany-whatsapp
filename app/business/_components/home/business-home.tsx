import Link from "next/link";
import { Bot, Inbox, Megaphone, MessageSquareReply, Send, Users, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { BusinessHome as BusinessHomeModel, HomeAutomations, HomeConversation, HomeConversationStatus, HomeMetric, HomeModuleId } from "@/lib/dashboard/business-home";
import { ConnectionStatus } from "./connection-status";
import { Greeting } from "./greeting";
import { EmptyState, Initials, Panel, Surface, shortTime } from "./home-primitives";

const metricIcons: Record<HomeMetric["id"], LucideIcon> = {
  "needs-reply": MessageSquareReply,
  customers: Users,
  "automation-runs": Bot,
  "messages-sent": Send,
};

function MetricCard({ metric }: { metric: HomeMetric }) {
  const Icon = metricIcons[metric.id];
  const highlight = metric.id === "needs-reply" && !!metric.value;
  return (
    <Link href={metric.href} className="group block rounded-xl focus-visible:outline-offset-2">
      <Surface className="h-full p-4 transition-shadow group-hover:shadow-[0_2px_8px_rgb(9_9_11/0.06),0_0_0_1px_rgb(9_9_11/0.08)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
          <Icon className={cn("size-4", highlight ? "text-primary" : "text-muted-foreground/70")} aria-hidden="true" />
        </div>
        <p className={cn("mt-2 text-[28px] font-semibold leading-8 tracking-tight tabular-nums", metric.value === null && "text-muted-foreground/50")}>
          {metric.value ?? "—"}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{metric.detail}</p>
      </Surface>
    </Link>
  );
}

const statusStyles: Record<HomeConversationStatus, { label: string; className: string }> = {
  needs_reply: { label: "Needs reply", className: "bg-primary/8 text-primary" },
  handed_off: { label: "Waiting for team", className: "bg-amber-500/10 text-amber-800" },
  open: { label: "Open", className: "bg-muted text-muted-foreground" },
  waiting: { label: "Awaiting customer", className: "bg-muted text-muted-foreground" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
};

function ConversationStatus({ status }: { status: HomeConversationStatus }) {
  const { label, className } = statusStyles[status];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[11px] font-medium", className)}>{label}</span>;
}

function ConversationRow({ conversation, now, action }: { conversation: HomeConversation; now: number; action?: boolean }) {
  return (
    <li>
      <Link href={conversation.href} className="group flex items-center gap-4 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 sm:px-2">
        <Initials name={conversation.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn("truncate text-sm", conversation.unread ? "font-semibold" : "font-medium")}>{conversation.name}</p>
            <time className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={conversation.at ?? undefined}>{shortTime(conversation.at, now)}</time>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <p className={cn("min-w-0 flex-1 truncate text-xs", conversation.unread ? "text-foreground/80" : "text-muted-foreground")}>{conversation.preview}</p>
            {action ? <ConversationStatus status={conversation.status} /> : conversation.unread > 0 && (
              <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums" aria-label={`${conversation.unread} unread`}>{conversation.unread}</span>
            )}
          </div>
        </div>
        {action && <span className="hidden shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground sm:inline">Open</span>}
      </Link>
    </li>
  );
}

function NeedsAttention({ items, inbox, now }: { items: HomeConversation[]; inbox: string; now: number }) {
  return (
    <Panel title="Needs attention" description="Customers waiting for a reply from your team" action={items.length ? { label: "Open inbox", href: inbox } : undefined}>
      {items.length
        ? <ul className="flex flex-col">{items.map(item => <ConversationRow key={item.id} conversation={item} now={now} action />)}</ul>
        : <EmptyState title="You're all caught up" description="New customer messages that need a person will appear here." />}
    </Panel>
  );
}

function RecentConversations({ items, inbox, now }: { items: HomeConversation[]; inbox: string; now: number }) {
  return (
    <Panel title="Recent conversations" action={items.length ? { label: "View all", href: inbox } : undefined}>
      {items.length
        ? <ul className="flex flex-col">{items.map(item => <ConversationRow key={item.id} conversation={item} now={now} />)}</ul>
        : <EmptyState title="No conversations yet" description="When customers message your WhatsApp number, their conversations show up here." />}
    </Panel>
  );
}

const automationStatus: Record<"active" | "paused" | "draft", { label: string; className: string }> = {
  active: { label: "Active", className: "text-emerald-700" },
  paused: { label: "Paused", className: "text-amber-700" },
  draft: { label: "Draft", className: "text-muted-foreground" },
};

function AutomationActivity({ automations, href, now }: { automations: HomeAutomations; href: string; now: number }) {
  if (automations.state !== "ready")
    return (
      <Panel title="Automation activity">
        {automations.state === "plan"
          ? <EmptyState title="Automations are on the Pro plan" description="Answer product, order and support questions automatically." />
          : <EmptyState title="Automation activity is unavailable" description="Try again in a moment." />}
      </Panel>
    );
  return (
    <Panel title="Automation activity" description="Conversations handled automatically · last 7 days" action={{ label: "Manage", href }}>
      {automations.items.length ? (
        <ul className="flex flex-col">
          {automations.items.slice(0, 5).map(item => (
            <li key={item.id} className="flex items-center gap-4 rounded-lg px-2 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Workflow className="size-4" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className={automationStatus[item.status].className}>{automationStatus[item.status].label}</span>
                  {item.lastRunAt ? ` · last run ${shortTime(item.lastRunAt, now)}` : " · not run yet"}
                  {item.failed ? <span className="text-primary"> · {item.failed} failed</span> : null}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums">{item.runs}</span>
                <span className="block text-[11px] text-muted-foreground">{item.runs === 1 ? "run" : "runs"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No automations yet" description="Reply to common questions like product browsing, order tracking and offers automatically." action={{ label: "Create automation", href }} />}
    </Panel>
  );
}

function QuickActions({ links }: { links: BusinessHomeModel["links"] }) {
  const actions: Array<{ label: string; href: string; icon: LucideIcon }> = [
    { label: "Open inbox", href: links.inbox, icon: Inbox },
    { label: "Create campaign", href: links.campaigns, icon: Megaphone },
    { label: "Create automation", href: links.automations, icon: Workflow },
    { label: "View customers", href: links.customers, icon: Users },
  ];
  return (
    <Panel title="Quick actions">
      <ul className="grid grid-cols-2 gap-2 px-2 pb-2 sm:px-0 sm:pb-0">
        {actions.map(({ label, href, icon: Icon }) => (
          <li key={label}>
            <Link href={href} className="flex h-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-3 text-xs font-medium transition-colors hover:bg-muted">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Product-agnostic Home: the shell, header and metrics are shared, and products choose modules. */
export function BusinessHome({ home }: { home: BusinessHomeModel }) {
  const now = home.generatedAt;
  const main: Partial<Record<HomeModuleId, React.ReactNode>> = {
    attention: <NeedsAttention key="attention" items={home.attention} inbox={home.links.inbox} now={now} />,
    recent: <RecentConversations key="recent" items={home.recent} inbox={home.links.inbox} now={now} />,
  };
  const side: Partial<Record<HomeModuleId, React.ReactNode>> = {
    automations: <AutomationActivity key="automations" automations={home.automations} href={home.links.automations} now={now} />,
  };
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
      <header className="flex flex-col gap-4 pt-2 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Greeting name={home.business.name} />
          <p className="mt-1 text-sm text-muted-foreground">Here&rsquo;s what&rsquo;s happening on WhatsApp today.</p>
        </div>
        <div className="w-full sm:max-w-sm lg:w-auto lg:min-w-72">
          <ConnectionStatus connection={home.connection} href={home.links.whatsapp} />
        </div>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {home.metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">{home.modules.map(id => main[id]).filter(Boolean)}</div>
        <div className="flex min-w-0 flex-col gap-6">
          {home.modules.map(id => side[id]).filter(Boolean)}
          <QuickActions links={home.links} />
        </div>
      </div>
    </div>
  );
}
