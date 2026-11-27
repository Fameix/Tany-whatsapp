import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function WorkspaceNotFound() {
  return (
    <Card className="mx-auto max-w-lg gap-4 p-6">
      <h1 className="text-lg font-semibold">Workspace not found</h1>
      <p className="text-sm text-muted-foreground">
        The business or workspace page does not exist.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to your workspace</Link>
      </Button>
    </Card>
  );
}
