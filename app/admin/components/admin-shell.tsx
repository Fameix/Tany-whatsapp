"use client";

import { Suspense, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRight,
  Search,
  LayoutDashboard,
  Users,
  Inbox,
  FileText,
  Megaphone,
  Workflow,
  CheckCheck,
  Activity,
  MessageCircle,
  Settings,
  Home,
  type LucideIcon,
} from "lucide-react";
import type { AdminBusiness } from "@/lib/admin/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type NavLink = { label: string; href: string; icon: LucideIcon; match?: string[]; nested?: boolean };

/** Business workspaces get a customer-facing hierarchy; technical pages stay reachable
 * from Settings → WhatsApp diagnostics and keep their existing URLs. */
function businessNavigation(business: AdminBusiness): { primary: NavLink[]; secondary: NavLink[] } {
  const root = `/business/${encodeURIComponent(business.id)}`;
  return {
    primary: [
      { label: "Home", href: root, icon: Home },
      { label: "Inbox", href: `${root}/inbox`, icon: Inbox },
      { label: "Customers", href: `${root}/contacts`, icon: Users },
      { label: "Automations", href: `${root}/automations`, icon: Workflow },
      { label: "Campaigns", href: `${root}/campaigns`, icon: Megaphone },
      { label: "Templates", href: `${root}/templates`, icon: FileText, nested: true },
    ],
    secondary: [
      { label: "WhatsApp", href: `${root}/whatsapp`, icon: MessageCircle, match: [`${root}/whatsapp/setup`, `${root}/whatsapp-accounts`] },
      { label: "Settings", href: `${root}/settings`, icon: Settings, match: [`${root}/message-status`, `${root}/webhook-health`] },
    ],
  };
}
const businessPageLabels: Record<string, string> = {
  "message-status": "Message status",
  "webhook-health": "Webhook health",
  "whatsapp-accounts": "WhatsApp account",
  "whatsapp/setup": "Connect WhatsApp",
};
const isActive = (pathname: string, link: NavLink) => pathname === link.href || !!link.match?.includes(pathname) || (!!link.nested && pathname.startsWith(`${link.href}/`));

function linksFor(business?: AdminBusiness): NavLink[] {
  if (business) {
    const { primary, secondary } = businessNavigation(business);
    return [...primary, ...secondary];
  }
  const root = "/admin";
  return [
    { label: "Overview", href: root, icon: LayoutDashboard },
    { label: "Inbox", href: `${root}/inbox`, icon: Inbox },
    { label: "Contacts", href: `${root}/contacts`, icon: Users },
    { label: "Templates", href: `${root}/templates`, icon: FileText },
    { label: "Campaigns", href: `${root}/campaigns`, icon: Megaphone },
    { label: "Automations", href: `${root}/automations`, icon: Workflow },
    {
      label: "Message Status",
      href: `${root}/message-status`,
      icon: CheckCheck,
    },
    { label: "Webhook Health", href: `${root}/webhook-health`, icon: Activity },
    { label: "WhatsApp Accounts", href: `${root}/whatsapp-accounts`, icon: MessageCircle },
    { label: "Setup Requests", href: `${root}/setup-requests`, icon: MessageCircle },
    { label: "Settings", href: `${root}/settings`, icon: Settings },
  ];
}
function Navigation({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {links.map((link) => {
        const { label, href, icon: Icon } = link;
        const active = isActive(pathname, link);
        return (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            asChild
            isActive={active}
            className="h-9 font-medium"
          >
            <Link
              href={href}
              onClick={() => setOpenMobile(false)}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              <span>{label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}
function WorkspaceSidebar({
  business,
  workspaceSwitcher,
}: {
  business?: AdminBusiness;
  workspaceSwitcher: React.ReactNode;
}) {
  const loading = <div className="h-9 animate-pulse rounded-md bg-muted" />;
  const groups = business ? businessNavigation(business) : null;
  return (
    <Sidebar collapsible="offcanvas">
      <div className="border-b p-2">{workspaceSwitcher}</div>
      <SidebarContent>
        {groups ? (
          <>
            <SidebarGroup className="px-2 pt-4">
              <SidebarGroupContent>
                <Suspense fallback={loading}><Navigation links={groups.primary} /></Suspense>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="mt-auto px-2 pb-4">
              <SidebarGroupContent>
                <Suspense fallback={loading}><Navigation links={groups.secondary} /></Suspense>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <SidebarGroup className="px-2">
            <SidebarGroupLabel className="px-2 text-[11px]">
              Products
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <Suspense fallback={loading}><Navigation links={linksFor()} /></Suspense>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
function Breadcrumb({ business }: { business?: AdminBusiness }) {
  const pathname = usePathname();
  const links = linksFor(business);
  const root = links[0].href;
  const current =
    links.find((entry) => entry.href === pathname)?.label ??
    (business ? businessPageLabels[pathname.slice(root.length + 1)] ?? (pathname.startsWith(`${root}/templates/`) ? "Template" : undefined) : undefined) ??
    (pathname.endsWith("/new") ? "New business" : business ? "Workspace" : "Business profile");
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-xs"
    >
      <Link
        href={links[0].href}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        {business?.name ?? "Super Admin"}
      </Link>
      <ChevronRight
        className="size-3 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="truncate font-medium" aria-current="page">
        {current}
      </span>
    </nav>
  );
}
export function AdminShell({
  children,
  business,
  workspaceSwitcher,
}: {
  children: React.ReactNode;
  business?: AdminBusiness;
  workspaceSwitcher: React.ReactNode;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const navigate = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };
  const commands = linksFor(business);
  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider
        className="tany-admin"
        style={{ "--sidebar-width": "15rem" } as CSSProperties}
      >
        <a
          href="#admin-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4"
        >
          Skip to content
        </a>
        <WorkspaceSidebar
          business={business}
          workspaceSwitcher={workspaceSwitcher}
        />
        <SidebarInset className="min-w-0">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger className="-ml-1" />
              </TooltipTrigger>
              <TooltipContent>Toggle sidebar (Ctrl+B)</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-2 h-4!" />
            <Suspense
              fallback={
                <span className="text-xs">
                  {business?.name ?? "Super Admin"}
                </span>
              }
            >
              <Breadcrumb business={business} />
            </Suspense>
            <div className="ml-auto flex items-center gap-3">
              <Button
                variant="outline"
                className="h-8 gap-2 px-2 text-xs text-muted-foreground sm:w-48 sm:justify-start"
                onClick={() => setCommandOpen(true)}
                aria-label="Quick navigation (Ctrl+K)"
              >
                <Search className="size-3.5" />
                <span className="hidden sm:inline">Quick navigation</span>
                <kbd className="ml-auto hidden rounded border bg-muted px-1 text-[10px] sm:inline">
                  Ctrl K
                </kbd>
              </Button>
              {!business && (
                <Badge
                  variant="secondary"
                  className="hidden rounded-md text-[10px] font-normal sm:inline-flex"
                >
                  Super Admin
                </Badge>
              )}
            </div>
          </header>
          <div
            id="admin-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1440px] p-4 sm:p-6"
          >
            {children}
          </div>
        </SidebarInset>
        <CommandDialog
          open={commandOpen}
          onOpenChange={setCommandOpen}
          title="Quick navigation"
          description={
            business
              ? `Navigate ${business.name}.`
              : "Navigate Tany Super Admin."
          }
        >
          <Command>
            <CommandInput placeholder="Find a page..." />
            <CommandList>
              <CommandEmpty>No pages found.</CommandEmpty>
              <CommandGroup heading={business?.name ?? "Super Admin"}>
                {commands.map(({ label, href, icon: Icon }) => (
                  <CommandItem key={href} onSelect={() => navigate(href)}>
                    <Icon />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </CommandDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
