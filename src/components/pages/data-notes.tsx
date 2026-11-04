import type { Kpis } from "@/server/metrics/sales";

/** Surfaces data limitations that affect the numbers above, instead of hiding them. */
export function DataNotes({ kpis }: { kpis: Kpis }) {
  const notes: string[] = [];
  const missing = kpis.open.missingValue + kpis.won.missingValue + kpis.lost.missingValue;
  if (missing) notes.push(`${missing} opportunities in these figures have no value in PB. They are counted, but excluded from dollar totals and averages (not treated as $0).`);
  if (kpis.closedWithoutDate) notes.push(`${kpis.closedWithoutDate} won/lost opportunities have no close date in PB, so they cannot be placed in a period and are excluded from won/lost figures.`);
  notes.push("Won Sales is the PB expected value of won opportunities, not recognized accounting revenue.");
  return (
    <aside className="mt-6 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
      <h2 className="mb-1 font-medium text-foreground">About these numbers</h2>
      <ul className="list-disc space-y-0.5 pl-4">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </aside>
  );
}
