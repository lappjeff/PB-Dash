"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Segmented } from "@/components/charts/pipeline-chart";

type V = "all" | "open" | "won" | "lost";

export function StatusFilter({ value }: { value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = (value === "pending" ? "open" : value ?? "all") as V;
  return (
    <Segmented<V>
      value={current}
      onChange={(v) => {
        const q = new URLSearchParams(sp.toString());
        if (v === "all") q.delete("status");
        else q.set("status", v);
        q.delete("page");
        router.push(`${pathname}?${q.toString()}`, { scroll: false });
      }}
      options={[
        { value: "all", label: "All" },
        { value: "open", label: "Open" },
        { value: "won", label: "Won" },
        { value: "lost", label: "Lost" },
      ]}
    />
  );
}
