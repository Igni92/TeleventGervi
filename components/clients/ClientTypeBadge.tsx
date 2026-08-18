import * as React from "react";
import { segmentBadgeClass } from "@/lib/segments";
import { cn } from "@/lib/utils";

/**
 * Pilule de segment client (GMS / CHR / EXPORT) — couleurs canoniques de
 * lib/segments.ts, repli neutre pour tout autre type (Rungis, inconnu…).
 */
export function ClientTypeBadge({
  type,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { type: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        segmentBadgeClass(type),
        className
      )}
      {...props}
    >
      {children ?? type}
    </span>
  );
}
