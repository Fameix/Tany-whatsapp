import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function SuperAdminSignInRequired() {
  return (
    <main className="tany-admin flex min-h-svh items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-lg gap-4 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-primary">Tany Super Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight">Super Admin sign-in required</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Sign in to the Tany admin portal with your Super Admin account to open Messaging.
        </p>
        <Button asChild>
          <a href="https://app.tany.in/admin/messaging">Continue to Tany Admin</a>
        </Button>
      </Card>
    </main>
  );
}
