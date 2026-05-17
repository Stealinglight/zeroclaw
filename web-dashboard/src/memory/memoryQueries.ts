/**
 * React Query hooks for the Memory page (M5.2, US-001 + US-002).
 *
 * Backend contracts (crates/zeroclaw-gateway/src/api.rs):
 *   GET    /api/memory                       handle_api_memory_list
 *     ?query=<text>     → recall mode (api.rs:672) — fuzzy search
 *     ?category=<name>  → list mode filter (core / daily / conversation /
 *                          custom-string)
 *     ?since=<rfc3339>  → recall-mode lower bound
 *     ?until=<rfc3339>  → recall-mode upper bound
 *   POST   /api/memory                       handle_api_memory_store
 *   DELETE /api/memory/:key                  handle_api_memory_delete
 *
 * Wire format MemoryEntry comes from
 * crates/zeroclaw-api/src/memory_traits.rs:30 — id/key/content/category/
 * timestamp/session_id/score/namespace/importance/superseded_by. The
 * Overview card (M5.0) only reads key/content/timestamp; this page reads
 * the wider shape.
 *
 * Why a single query key keyed on filter inputs: React Query treats
 * different keys as separate caches, so flipping the category dropdown
 * keeps the previous result in cache while the new one loads — feels
 * snappier than a refetch-in-place. `staleTime` is short (5s) because
 * agents write memory continuously while a user is browsing and a stale
 * list misleads more than the refetch cost saves.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiFetch";

// ── Wire shape ─────────────────────────────────────────────────────

/**
 * Mirror of `crates/zeroclaw-api/src/memory_traits.rs` MemoryEntry.
 *
 * `category` deserialises through MemoryCategory's manual Deserialize:
 * "core" / "daily" / "conversation" map to Core/Daily/Conversation; any
 * other string maps to Custom(string). The wire form is therefore the
 * raw category string, which this page renders verbatim.
 */
export interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  category: string;
  timestamp: string;
  session_id?: string | null;
  score?: number | null;
  namespace: string;
  importance?: number | null;
  superseded_by?: string | null;
}

export interface MemoryListResponse {
  entries: MemoryEntry[];
}

// ── Filters ────────────────────────────────────────────────────────

/**
 * `category: ""` means "all". The dropdown emits empty-string for the
 * default option; callers building the URL drop it before issuing the
 * request. `query: ""` means no search.
 */
export interface MemoryFilters {
  category: string;
  query: string;
}

export const EMPTY_FILTERS: MemoryFilters = { category: "", query: "" };

export function isFilterActive(filters: MemoryFilters): boolean {
  return filters.category !== "" || filters.query.trim() !== "";
}

function buildMemoryUrl(filters: MemoryFilters): string {
  const params = new URLSearchParams();
  if (filters.category !== "") {
    params.set("category", filters.category);
  }
  if (filters.query.trim() !== "") {
    params.set("query", filters.query.trim());
  }
  const qs = params.toString();
  return qs === "" ? "/api/memory" : `/api/memory?${qs}`;
}

// ── List query ─────────────────────────────────────────────────────

export const MEMORY_LIST_KEY = ["memory", "list"] as const;

/**
 * Fetch memory entries with the given filters. The query key includes
 * the filters so distinct filter combinations are cached independently
 * — a user toggling categories keeps prior results warm.
 */
export function useMemoryListQuery(filters: MemoryFilters) {
  return useQuery({
    queryKey: [...MEMORY_LIST_KEY, filters.category, filters.query],
    queryFn: () =>
      apiFetch<MemoryListResponse>(buildMemoryUrl(filters)),
    // Memory rows are written continuously by the agent. 5s gives a
    // useful tradeoff between freshness and request volume during
    // active browsing.
    staleTime: 5_000,
  });
}

// ── Delete mutation ────────────────────────────────────────────────

export interface MemoryDeleteResponse {
  status: string;
  /** The backend may return false when the key was already absent —
   *  we still treat that as a successful idempotent deletion. */
  deleted: boolean;
}

export function useDeleteMemoryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<MemoryDeleteResponse>(
        `/api/memory/${encodeURIComponent(key)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      // Invalidate every cached filter combination so all list views
      // (current filters + any others previously fetched) re-fetch.
      void queryClient.invalidateQueries({ queryKey: MEMORY_LIST_KEY });
      // Invalidate the Overview card key (M5.0) so the Memory count
      // there refreshes after a deletion.
      void queryClient.invalidateQueries({ queryKey: ["overview", "memory"] });
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────

// Re-export the shared time formatter so existing imports from this
// module keep working — the canonical location is now @/lib.
export { formatRelativeTime } from "@/lib/formatRelativeTime";

/**
 * The four built-in MemoryCategory variants the backend recognises as
 * non-Custom — see crates/zeroclaw-api/src/memory_traits.rs Deserialize
 * impl. These are the dropdown's known options; entries whose category
 * field doesn't match falls through to display as-is (Custom variant
 * via the wire format).
 */
export const KNOWN_CATEGORIES = ["core", "daily", "conversation"] as const;

export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];
