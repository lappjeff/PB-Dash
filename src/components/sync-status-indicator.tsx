import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative, formatDateTime } from "@/lib/format";

/**
 * Shows how fresh the local data is. Dashboards always read the local database, so when
 * PB is unreachable the app keeps working and this timestamp says how old the data is.
 */
export function SyncStatusIndicator(props: {
  dataAsOf: string | null;
  lastSuccessfulSync: string | null;
  failedWebhooks: number;
  lastRunFailed: boolean;
  isAdmin: boolean;
}) {
  const problem = props.failedWebhooks > 0 || props.lastRunFailed;
  const never = !props.dataAsOf;
  const Icon = never ? CircleDashed : problem ? AlertTriangle : CheckCircle2;
  const label = never ? "Not synced yet" : `Data as of ${formatRelative(props.dataAsOf!)}`;
  const content = (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
      <Icon className={problem ? "size-3.5 text-status-warning" : never ? "size-3.5" : "size-3.5 text-status-good"} aria-hidden />
      <span>{label}</span>
      {problem && <span className="font-medium text-foreground">· needs attention</span>}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={props.isAdmin ? <Link href="/settings#sync" /> : <span />}>{content}</TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5">
          <div>Latest record sync: {props.dataAsOf ? formatDateTime(props.dataAsOf) : "never"}</div>
          <div>Last successful scheduled sync: {props.lastSuccessfulSync ? formatDateTime(props.lastSuccessfulSync) : "never"}</div>
          {props.failedWebhooks > 0 && <div>{props.failedWebhooks} webhook event(s) failed processing</div>}
          {props.lastRunFailed && <div>The most recent sync run failed</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
