import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Stat tile: label · value · optional note; links to the underlying records. */
export function KpiCard({
  label,
  value,
  note,
  definition,
  href,
  tone,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  definition?: string;
  href?: string;
  tone?: "warning";
}) {
  const body = (
    <div
      className={cn(
        "group flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors",
        href && "hover:border-foreground/25",
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone === "warning" && <span className="size-1.5 rounded-full bg-status-warning" aria-hidden />}
        <span>{label}</span>
        {href && <ArrowUpRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
  return (
    <div className="relative">
      {href ? (
        <Link href={href} className="block h-full rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          {body}
        </Link>
      ) : (
        body
      )}
      {definition && <DefinitionHint text={definition} className="absolute top-3.5 right-3" />}
    </div>
  );
}

export function DefinitionHint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label="How this is calculated" className={cn("rounded text-muted-foreground/70 hover:text-foreground", className)} />}
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  );
}

export function Section({ title, description, action, children, className, definition }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; definition?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            {title}
            {definition && <DefinitionHint text={definition} />}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
