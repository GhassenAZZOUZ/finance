import type { ActualStatus } from "@/lib/engine";
import { STATUS_LABEL } from "@/lib/labels";
import { STATUS_TONE } from "./tones";

/** Green / orange / red badge for a monthly check-in status. */
export function StatusBadge({ status }: { status: ActualStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const tone = STATUS_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone.badge}`}>
      <span aria-hidden className={`size-2 rounded-full ${tone.dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
