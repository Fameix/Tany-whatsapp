import { Card } from "@/components/ui/card";

/** `businessId`: sign in to that business with a WhatsApp code from its own number. */
export function DashboardAccessRequired({ businessId }: { businessId?: string } = {}) {
  const local = process.env.NODE_ENV === "development";
  return (
    <main className="tany-admin flex min-h-svh items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-lg gap-4 p-6 shadow-sm sm:p-8" role="alert">
        <p className="text-sm font-medium text-primary">Tany Messaging</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Dashboard sign-in required
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This workspace needs a verified dashboard session before business data
          can be displayed.
        </p>
        {local ? (
          <div className="rounded-md border bg-muted/40 p-4 text-sm leading-6">
            <p className="font-medium">Local development</p>
            <p className="mt-1 text-muted-foreground">
              Run the following in a terminal, then open the one-time URL it
              prints in this browser.
            </p>
            <code className="mt-3 block rounded bg-background px-3 py-2 font-mono text-xs">
              npm run dev:admin-session
            </code>
          </div>
        ) : (
          <p className="rounded-md border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
            Open Messaging from the authenticated Tany dashboard to establish a
            signed workspace session.
          </p>
        )}
        <a href={businessId ? `/login?business=${encodeURIComponent(businessId)}` : "/login"} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Sign in with phone
        </a>
      </Card>
    </main>
  );
}
