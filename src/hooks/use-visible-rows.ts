import { useEffect, useMemo, useState } from "react";
import { isConstrainedClient } from "./use-network-status";

/**
 * Incremental rendering for long tables/lists.
 *
 * Server queries already cap at a few hundred rows, but painting all of them
 * (plus their buttons/badges) is the dominant cost on these pages. We render
 * a page at a time and let the user reveal more — no data, filtering or
 * ordering behaviour changes.
 */
export function useVisibleRows<T>(rows: T[], pageSize = 100) {
  // Phones and Save-Data links paint far fewer rows up front; "Show more"
  // reveals the rest without changing any data or ordering.
  const [step] = useState(() => (isConstrainedClient() ? Math.max(15, Math.round(pageSize / 4)) : pageSize));
  const [visible, setVisible] = useState(step);

  // Filters/search shrink the list — start again from the first page.
  useEffect(() => {
    setVisible(step);
  }, [rows.length, step]);

  const shown = useMemo(() => rows.slice(0, visible), [rows, visible]);

  return {
    shown,
    hasMore: shown.length < rows.length,
    remaining: rows.length - shown.length,
    showMore: () => setVisible((v) => v + step),
  };
}
