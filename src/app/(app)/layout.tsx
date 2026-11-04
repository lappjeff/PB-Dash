import { desc, eq } from "drizzle-orm";
import { AuthError } from "@/server/authz";
import { pageContext } from "@/server/page";
import { authMode } from "@/server/auth";
import { appMode } from "@/env";
import { users } from "@/db/schema";
import { getSyncStatus } from "@/server/metrics/analytics";
import { Sidebar } from "@/components/app/sidebar";
import { SyncStatusIndicator } from "@/components/sync-status-indicator";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { DemoBanner, DemoUserSwitcher } from "@/components/app/demo";
import { ClerkUserButton } from "@/components/app/clerk-user";
import { MobileNav } from "@/components/app/mobile-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let ctx;
  try {
    ctx = await pageContext();
  } catch (e) {
    if (e instanceof AuthError) return <ConfigProblem title="Sign-in unavailable" message={e.message} />;
    if (appMode() === "misconfigured") {
      return <ConfigProblem title="Not configured" message="DATABASE_URL is not set. Configure the database (and Clerk) or set DEMO_MODE=true for a demo deployment." />;
    }
    throw e;
  }
  const { viewer, db } = ctx;
  const demo = authMode() === "demo";
  const status = await getSyncStatus(db);
  const demoUsers = demo
    ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.isDemo, true)).orderBy(desc(users.role), users.name)
    : [];

  const nav = {
    isAdmin: viewer.role === "ADMIN",
    hasSalesperson: viewer.salespersonId !== null,
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar {...nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        {demo && <DemoBanner />}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-6">
          <MobileNav {...nav} />
          <div className="min-w-0 flex-1" />
          <SyncStatusIndicator
            dataAsOf={status.dataAsOf}
            lastSuccessfulSync={status.lastSuccessfulSync?.completedAt ?? null}
            failedWebhooks={(status.webhookCounts.failed ?? 0) + (status.webhookCounts.dead ?? 0)}
            lastRunFailed={status.recentRuns[0]?.status === "failed"}
            isAdmin={nav.isAdmin}
          />
          <ThemeToggle />
          {demo ? <DemoUserSwitcher current={viewer.userId} users={demoUsers} /> : <ClerkUserButton />}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}

function ConfigProblem({ title, message }: { title: string; message: string }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <p className="mt-4 text-xs text-muted-foreground">See README → Environment variables.</p>
      </div>
    </main>
  );
}
