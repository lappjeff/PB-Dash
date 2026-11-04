"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Thresholds } from "@/server/settings";
import { saveThresholdsAction, saveTargetsAction, saveUserLinkAction, savePbUserMappingAction, type ActionResult } from "./actions";

function Result({ r }: { r: ActionResult | null }) {
  if (!r) return null;
  return (
    <p role="status" className={`text-xs ${r.ok ? "text-muted-foreground" : "text-status-critical"}`}>
      {r.message}
    </p>
  );
}

const centsToDollars = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");

export function ThresholdsForm({ t }: { t: Thresholds }) {
  const [state, action, pending] = useActionState(saveThresholdsAction, null);
  const field = (name: string, label: string, value: number | string, suffix?: string) => (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <Input name={name} defaultValue={value} inputMode="numeric" className="text-right tabular" />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </span>
    </label>
  );
  return (
    <form action={action} className="space-y-3">
      {field("highValue", "High-value opportunity at or above ($)", centsToDollars(t.highValueCents))}
      {field("highValueStaleDays", "…flag when no PB change seen for", t.highValueStaleDays, "days")}
      {field("stageAgingDays", "Flag when in one stage longer than", t.stageAgingDays, "days")}
      {field("noRecentActivityDays", "Note when no activity completed for", t.noRecentActivityDays, "days")}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="includeArchivedInClosed" defaultChecked={t.includeArchivedInClosed} className="size-4" />
        Include archived opportunities in won/lost metrics
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Save thresholds
        </Button>
        <Result r={state} />
      </div>
    </form>
  );
}

export function TargetsForm({ month, salespeople, targets }: { month: string; salespeople: { id: number; name: string }[]; targets: Record<number, number> }) {
  const [state, action, pending] = useActionState(saveTargetsAction, null);
  const router = useRouter();
  return (
    <form action={action} className="space-y-2" key={month}>
      <label className="flex items-center gap-2 text-sm">
        Month
        <input type="month" name="month" defaultValue={month} className="h-8 rounded-lg border bg-background px-2 text-sm" onChange={(e) => e.target.value && router.push(`/settings?month=${e.target.value}`, { scroll: false })} />
      </label>
      <div className="grid gap-1.5">
        {salespeople.map((s) => (
          <label key={s.id} className="grid grid-cols-[1fr_9rem] items-center gap-3 text-sm">
            <span>{s.name}</span>
            <Input name={`target_${s.id}`} defaultValue={targets[s.id] !== undefined ? centsToDollars(targets[s.id]) : ""} placeholder="—" inputMode="decimal" className="text-right tabular" aria-label={`Target for ${s.name} in dollars`} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" size="sm" disabled={pending}>
          Save targets
        </Button>
        <Result r={state} />
      </div>
    </form>
  );
}

export function UserLinkRow({
  user,
  salespeople,
  isSelf,
}: {
  user: { id: number; name: string; email: string | null; role: "ADMIN" | "SALESPERSON"; salespersonId: number | null };
  salespeople: { id: number; name: string; active: boolean }[];
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState(saveUserLinkAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
      <input type="hidden" name="userId" value={user.id} />
      <div className="min-w-48 flex-1">
        <div className="font-medium">
          {user.name} {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
        </div>
        <div className="text-xs text-muted-foreground">{user.email ?? "no email"}</div>
      </div>
      <select name="role" defaultValue={user.role} className="h-8 rounded-lg border bg-background px-2" aria-label={`Role for ${user.name}`}>
        <option value="SALESPERSON">Salesperson</option>
        <option value="ADMIN">Admin</option>
      </select>
      <select name="salespersonId" defaultValue={user.salespersonId ?? ""} className="h-8 rounded-lg border bg-background px-2" aria-label={`PB salesperson for ${user.name}`}>
        <option value="">— Not linked —</option>
        {salespeople.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.active ? "" : " (inactive)"}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Result r={state} />
    </form>
  );
}

export function PbUserMappingRow({ salesperson, pbUsers }: { salesperson: { id: number; name: string; pbUserId: string | null }; pbUsers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(savePbUserMappingAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="salespersonId" value={salesperson.id} />
      <span className="min-w-48 flex-1">{salesperson.name}</span>
      <select name="pbUserId" defaultValue={salesperson.pbUserId ?? ""} className="h-8 rounded-lg border bg-background px-2" aria-label={`PB user for ${salesperson.name}`}>
        <option value="">— Not mapped —</option>
        {pbUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Save
      </Button>
      <Result r={state} />
    </form>
  );
}

export function SyncControls({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const call = (url: string, body: unknown) =>
    start(async () => {
      setMsg(null);
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const json = await res.json();
        setMsg(res.ok ? json.message ?? "Done." : json.error?.message ?? `Failed (${res.status})`);
      } catch {
        setMsg("Request failed. Check your connection.");
      }
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => call("/api/admin/sync", { type: "reconcile" })}>
        <RefreshCw className={pending ? "animate-spin" : ""} /> Reconcile now
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => call("/api/admin/sync", { type: "full" })}>
        Full sync
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => call("/api/admin/sync", { type: "process-events" })}>
        Retry webhook queue
      </Button>
      {demo && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => call("/api/demo/simulate", { count: 5 })}>
          <Zap /> Simulate 5 stage-change webhooks (demo)
        </Button>
      )}
      {msg && (
        <span role="status" className="text-xs text-muted-foreground">
          {msg}
        </span>
      )}
    </div>
  );
}
