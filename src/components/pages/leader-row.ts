import type { SalespersonRow } from "@/server/metrics/sales";
import type { LeaderRow } from "@/components/sales-leaderboard";

export function toLeaderRow(r: SalespersonRow): LeaderRow {
  return {
    salespersonId: r.salespersonId,
    name: r.name,
    active: r.active,
    wonCents: r.won.valueCents,
    wonCount: r.won.count,
    lostCents: r.lost.valueCents,
    lostCount: r.lost.count,
    openCents: r.open.valueCents,
    openCount: r.open.count,
    winRate: r.winRate,
    avgWonCents: r.avgWonCents,
    medianCycleDays: r.medianCycleDays,
    overdueActivities: r.overdueActivities,
  };
}
