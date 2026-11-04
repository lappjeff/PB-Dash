"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border bg-card p-6">
      <h1 className="text-base font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The data shown in this app comes from its own database, so this is usually a database connection or configuration problem rather than Precise Builder being unavailable.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <Button className="mt-4" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
