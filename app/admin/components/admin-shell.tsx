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
  Boxes,
  Building2,
  FlaskConical,
  CalendarDays,
  CarFront,
  Package,
  Store,
  Truck,
  UserRoundSearch,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import type { AdminBusiness } from "@/lib/admin/types";
import { adminProductFromPath, adminProductPath, stagingBootstrapAttemptParam } from "@/lib/admin/product-routes";
import { productNavigation, type ProductSection } from "@/lib/admin/product-navigation";
import { workspaceProductModules, type WorkspaceProductModule } from "@/lib/admin/workspace-products";
import type { ActiveTanyVertical, TanyProduct } from "@/lib/messaging/vertical-config";
import { BrandLogo } from "@/components/brand-logo";
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
const productIcons: Record<ProductSection, LucideIcon> = {
  overview: LayoutDashboard, dealers: Building2, restaurants: Utensils, stores: Store,
  whatsapp: MessageCircle, "message-status": CheckCheck, "webhook-health": Activity,
  staging: FlaskConical, settings: Settings,
};
const workspaceIcons: Record<WorkspaceProductModule["section"], LucideIcon> = {
  products: Package, orders: Package, menu: Utensils, delivery: Truck,
  vehicles: CarFront, leads: UserRoundSearch, "test-drives": CalendarDays,
};
function adminGroups(product?: TanyProduct): { label?: string; links: NavLink[] }[] {
  if (!product) return adminNavigation();
  return productNavigation(product).map(group => ({
    label: group.label,
    links: group.links.map(link => ({ ...link, icon: productIcons[link.section], nested: link.section === "whatsapp" })),
  }));
}

/** Business workspaces get a customer-facing hierarchy; technical pages stay reachable
 * from Settings → WhatsApp diagnostics and keep their existing URLs. */
function businessNavigation(business: AdminBusiness, product: ActiveTanyVertical | null): { primary: NavLink[]; modules: NavLink[]; secondary: NavLink[] } {
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
    modules: workspaceProductModules(product).map(({ section, label }) => ({
      label, href: root + "/" + section, icon: workspaceIcons[section],
    })),
    secondary: [
      { label: "WhatsApp", href: `${root}/whatsapp`, icon: MessageCircle, match: [`${root}/whatsapp/setup`, `${root}/whatsapp-accounts`, `${root}/whatsapp/profile`] },
      { label: "Settings", href: `${root}/settings`, icon: Settings, match: [`${root}/message-status`, `${root}/webhook-health`] },
    ],
  };
}
const businessPageLabels: Record<string, string> = {
  "message-status": "Message status",
  "webhook-health": "Webhook health",
  "whatsapp-accounts": "WhatsApp account",
  "whatsapp/setup": "Connect WhatsApp",
  "whatsapp/profile": "Business profile",
};
const isActive = (pathname: string, link: NavLink) => pathname === link.href || !!link.match?.includes(pathname) || (!!link.nested && pathname.startsWith(`${link.href}/`));

function linksFor(business?: AdminBusiness, product?: TanyProduct, businessProduct: ActiveTanyVertical | null = null): NavLink[] {
  if (business) {
    const { primary, modules, secondary } = businessNavigation(business, businessProduct);
    return [...primary, ...modules, ...secondary];
  }
  return adminGroups(product).flatMap((group) => group.links);
}

/** Super Admin operations and configuration navigation. */
function adminNavigation(): Array<{ label?: string; links: NavLink[] }> {
  const root = "/admin";
  return [
    {
      links: [
        { label: "Overview", href: root, icon: LayoutDashboard },
        { label: "Businesses", href: `${root}/businesses`, icon: Building2, nested: true },
      ],
    },
    {
      label: "Operations",
      links: [
        { label: "Message Status", href: `${root}/message-status`, icon: CheckCheck },
        { label: "Webhook Health", href: `${root}/webhook-health`, icon: Activity },
        { label: "WhatsApp Accounts", href: `${root}/whatsapp-accounts`, icon: MessageCircle },
        { label: "Setup Requests", href: `${root}/setup-requests`, icon: MessageCircle },
      ],
    },
    {
      label: "System",
      links: [
        { label: "Test & Staging", href: `${root}/system`, icon: FlaskConical },
        { label: "Products", href: `${root}/products`, icon: Boxes, nested: true },
        { label: "Settings", href: `${root}/settings`, icon: Settings },
      ],
    },
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
  product,
  workspaceSwitcher,
  businessProduct = null,
}: {
  business?: AdminBusiness;
  product?: TanyProduct;
  workspaceSwitcher: React.ReactNode;
  businessProduct?: ActiveTanyVertical | null;
}) {
  const loading = <div className="h-9 animate-pulse rounded-md bg-muted" />;
  const groups = business ? businessNavigation(business, businessProduct) : null;
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
            {!!groups.modules.length && <SidebarGroup className="px-2">
              <SidebarGroupLabel>Product tools</SidebarGroupLabel>
              <SidebarGroupContent><Suspense fallback={loading}><Navigation links={groups.modules} /></Suspense></SidebarGroupContent>
            </SidebarGroup>}
            <SidebarGroup className="mt-auto px-2 pb-4">
              <SidebarGroupContent>
                <Suspense fallback={loading}><Navigation links={groups.secondary} /></Suspense>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <>
            {adminGroups(product).map((group, index) => (
              <SidebarGroup key={group.label ?? "main"} className={index ? "px-2" : "px-2 pt-4"}>
                {group.label && (
                  <SidebarGroupLabel className="px-2 text-[11px]">{group.label}</SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  <Suspense fallback={loading}><Navigation links={group.links} /></Suspense>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </>
        )}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
function Breadcrumb({ business, product, businessProduct }: { business?: AdminBusiness; product?: TanyProduct; businessProduct: ActiveTanyVertical | null }) {
  const pathname = usePathname();
  const links = linksFor(business, product, businessProduct);
  const root = links[0].href;
  const current =
    links.find((entry) => entry.href === pathname)?.label ??
    (business ? businessPageLabels[pathname.slice(root.length + 1)] ?? (pathname.startsWith(`${root}/templates/`) ? "Template" : undefined) : undefined) ??
    (pathname.endsWith("/new") ? "New business" : undefined) ??
    (!business ? links.find((entry) => entry.nested && pathname.startsWith(`${entry.href}/`))?.label : undefined) ??
    (business ? "Workspace" : "Business profile");
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-2 text-xs"
    >
      <Link
        href={product ? adminProductPath(product.id) : root}
        className="truncate text-muted-foreground hover:text-foreground"
      >
        {business?.name ?? product?.name ?? "Super Admin"}
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
  businessProduct = null,
}: {
  children: React.ReactNode;
  business?: AdminBusiness;
  workspaceSwitcher: React.ReactNode;
  businessProduct?: ActiveTanyVertical | null;
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const product = business ? undefined : adminProductFromPath(pathname);
  const title = business?.name ?? product?.name ?? "Tany Super Admin";
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
  useEffect(() => {
    if (business) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(stagingBootstrapAttemptParam)) return;
    url.searchParams.delete(stagingBootstrapAttemptParam);
    window.history.replaceState(window.history.state, "", url);
  }, [business, pathname]);
  const navigate = (href: string) => {
    setCommandOpen(false);
    router.push(href);
  };
  const commands = linksFor(business, product, businessProduct);
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
          product={product}
          workspaceSwitcher={workspaceSwitcher}
          businessProduct={businessProduct}
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
            {product && <BrandLogo vertical={product.id} decorative className="size-5" />}
            <Suspense
              fallback={
                <span className="text-xs">
                  {title}
                </span>
              }
            >
              <Breadcrumb business={business} product={product} businessProduct={businessProduct} />
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
                  {product ? product.status === "live" ? "Live" : "Coming soon" : "Tany Super Admin"}
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
          description={`Navigate ${title}.`}
        >
          <Command>
            <CommandInput placeholder="Find a page..." />
            <CommandList>
              <CommandEmpty>No pages found.</CommandEmpty>
              <CommandGroup heading={title}>
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
