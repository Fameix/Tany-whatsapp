"use client";

import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <Card className="gap-0 py-0 shadow-sm max-w-xl space-y-4 p-8" role="alert">
      <h1 className="text-xl font-semibold">Business data is temporarily unavailable</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Please try again.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </Card>
  );
}
