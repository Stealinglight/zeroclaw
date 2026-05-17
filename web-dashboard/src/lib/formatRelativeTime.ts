/**
 * Browser-native relative-time formatter ("3h ago", "in 5m").
 *
 * Used by Overview cards (M5.0) and the Memory page (M5.2) to render
 * timestamps in a human-friendly way without a date library. Intl
 * .RelativeTimeFormat is ES2020 and ships in every browser TS targets.
 *
 * Returning the raw input on parse failure keeps the UI from crashing
 * on backend regressions — a malformed timestamp shows up as itself
 * rather than "Invalid Date".
 */
export function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return fmt.format(diffSec, "second");
  if (abs < 3600) return fmt.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return fmt.format(Math.round(diffSec / 3600), "hour");
  return fmt.format(Math.round(diffSec / 86400), "day");
}
