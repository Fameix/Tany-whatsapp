"use client";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <Card className="gap-0 py-0 shadow-sm max-w-xl space-y-4 p-8" role="alert">
      <h1 className="text-xl font-semibold">Postgres dashboard data is unavailable</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Check the standalone Messaging Postgres connection and migration status,
        then try loading this page again. Firestore directory data is not used as
        a fallback.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
