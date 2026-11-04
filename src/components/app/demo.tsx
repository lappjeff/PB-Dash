"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { FlaskConical } from "lucide-react";

export function DemoBanner() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-status-warning/15 px-4 py-1.5 text-xs font-medium text-foreground">
      <FlaskConical className="size-3.5" aria-hidden />
      DEMO DATA — fictional records generated locally. Not connected to Precise Builder.
    </div>
  );
}

export function DemoUserSwitcher({ current, users }: { current: number; users: { id: number; name: string; role: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">Viewing as</span>
      <select
        className="h-8 rounded-lg border bg-background px-2 text-sm text-foreground"
        value={current}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await fetch("/api/demo/switch-user", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: Number(e.target.value) }),
            });
            router.push("/");
            router.refresh();
          })
        }
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} {u.role === "ADMIN" ? "(admin)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
