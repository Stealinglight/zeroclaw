/**
 * Memory page (M5.2, US-001 + US-002 + US-003).
 *
 * Browse, search, filter, and delete memory entries from /api/memory.
 *
 * Layout (vertical stack):
 *   1. Header — assistant identity + SectionNav + version + ThemeSwitcher
 *      (matches OverviewPage / SystemPage chrome).
 *   2. Filter row — category dropdown + debounced search input.
 *   3. Body — entries list, or skeleton (loading) / banner (error) /
 *      empty state (no rows).
 *
 * Strings inline per M3/M4/M5.0/M5.1 convention; localisation deferred
 * to M7 per plan §5.
 *
 * Why no manual store form: the agent already writes memory via tools.
 * A manual write surface adds validation surface area (key-format,
 * namespace selection, importance scoring) that's better deferred —
 * see PRD M5.2 out_of_scope.
 */
import { useEffect, useMemo, useState } from "react";
import { Brain, Search, Trash2 } from "lucide-react";
import { useControlUiBootstrap } from "@/app/ControlUiBootstrapProvider";
import { SectionNav } from "@/app/SectionNav";
import { ThemeSwitcher } from "@/theme/ThemeSwitcher";
import { useToast } from "@/lib/toasts";
import {
  EMPTY_FILTERS,
  KNOWN_CATEGORIES,
  formatRelativeTime,
  isFilterActive,
  useDeleteMemoryMutation,
  useMemoryListQuery,
  type MemoryEntry,
  type MemoryFilters,
} from "@/memory/memoryQueries";

const SEARCH_DEBOUNCE_MS = 250;

export function MemoryPage() {
  const bootstrap = useControlUiBootstrap();

  // Two-state debounce: `searchInput` tracks the input verbatim for
  // controlled-component behaviour; `filters.query` is what actually
  // drives the query, only updated after the debounce window so each
  // keystroke does not fire a new request.
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<MemoryFilters>(EMPTY_FILTERS);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) =>
        prev.query === searchInput ? prev : { ...prev, query: searchInput },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleCategoryChange = (category: string) => {
    setFilters((prev) => ({ ...prev, category }));
  };

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center justify-between gap-2 px-4 py-3 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">
            {bootstrap.assistant_identity.name}
          </span>
          <span style={{ color: "var(--color-text-muted)" }}>·</span>
          <SectionNav layout="inline" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-50">
            v{bootstrap.server_version}
          </span>
          <ThemeSwitcher />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <h1 className="text-base font-semibold mb-3">Memory</h1>
        <p
          className="text-sm mb-6 max-w-2xl"
          style={{ color: "var(--color-text-muted)" }}
        >
          Browse, search, and remove memory entries the agent has stored.
          Search runs as recall over content; the category filter narrows
          to a single bucket.
        </p>

        <FilterRow
          category={filters.category}
          searchInput={searchInput}
          onCategoryChange={handleCategoryChange}
          onSearchChange={setSearchInput}
        />

        <EntriesList filters={filters} />
      </main>
    </div>
  );
}

// ── Filter row ─────────────────────────────────────────────────────

interface FilterRowProps {
  category: string;
  searchInput: string;
  onCategoryChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

function FilterRow({
  category,
  searchInput,
  onCategoryChange,
  onSearchChange,
}: FilterRowProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 mb-4 max-w-4xl"
      role="search"
    >
      <label className="flex items-center gap-2 text-sm">
        <span style={{ color: "var(--color-text-muted)" }}>Category</span>
        <select
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="rounded border px-2 py-1 text-sm"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
          }}
          aria-label="Filter by category"
        >
          <option value="">All</option>
          {KNOWN_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm flex-1 min-w-[16rem]">
        <Search
          size={14}
          aria-hidden="true"
          style={{ color: "var(--color-text-muted)" }}
        />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search memory…"
          className="rounded border px-2 py-1 text-sm flex-1"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
          }}
          aria-label="Search memory"
        />
      </label>
    </div>
  );
}

// ── Entries list ───────────────────────────────────────────────────

function EntriesList({ filters }: { filters: MemoryFilters }) {
  const { data, isLoading, error } = useMemoryListQuery(filters);
  const entries = data?.entries;

  // Reverse-chronological — backend list/recall ordering is implementation
  // -defined; sorting client-side keeps the UX deterministic regardless
  // of which backend the gateway is wired to. Hook must run on every
  // render, so memoise outside the conditional branches.
  const sorted = useMemo(
    () =>
      entries
        ? [...entries].sort(
            (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
          )
        : [],
    [entries],
  );

  if (isLoading) {
    return <ListSkeleton />;
  }
  if (error) {
    return <ErrorBanner message={String(error)} />;
  }
  if (sorted.length === 0) {
    return <EmptyState filtered={isFilterActive(filters)} />;
  }

  return (
    <ul
      className="flex flex-col gap-2 max-w-4xl"
      aria-label="Memory entries"
    >
      {sorted.map((entry) => (
        <EntryRow key={entry.id || entry.key} entry={entry} />
      ))}
    </ul>
  );
}

function EntryRow({ entry }: { entry: MemoryEntry }) {
  const deleteMutation = useDeleteMemoryMutation();
  const { push } = useToast();

  const handleDelete = () => {
    const ok = window.confirm(
      `Delete memory entry "${entry.key}"? This cannot be undone.`,
    );
    if (!ok) return;
    deleteMutation.mutate(entry.key, {
      onSuccess: (res) => {
        push({
          kind: "info",
          title: "Memory deleted",
          body: res.deleted
            ? `Removed "${entry.key}".`
            : `"${entry.key}" was already gone.`,
        });
      },
      onError: (err) => {
        push({
          kind: "error",
          title: "Delete failed",
          body: String(err),
        });
      },
    });
  };

  const isDeleting = deleteMutation.isPending;

  return (
    <li
      className="rounded border p-3 flex items-start gap-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
        opacity: isDeleting ? 0.5 : 1,
      }}
    >
      <Brain
        size={14}
        aria-hidden="true"
        style={{ color: "var(--color-text-muted)" }}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-medium truncate">{entry.key}</span>
          <CategoryBadge category={entry.category} />
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
            title={entry.timestamp}
          >
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
        <p
          className="text-sm mt-1 truncate"
          style={{ color: "var(--color-text)" }}
          title={entry.content}
        >
          {entry.content}
        </p>
        {entry.namespace !== "default" || entry.importance != null ? (
          <p
            className="text-xs mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            {entry.namespace !== "default" ? `ns:${entry.namespace}` : null}
            {entry.namespace !== "default" && entry.importance != null
              ? " · "
              : null}
            {entry.importance != null
              ? `importance ${entry.importance.toFixed(2)}`
              : null}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting}
        aria-label={`Delete memory ${entry.key}`}
        className="p-1 rounded hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
        style={{ color: "var(--color-text-muted)" }}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className="text-xs uppercase tracking-wide rounded px-1.5 py-0.5"
      style={{
        background: "var(--color-surface-muted)",
        color: "var(--color-text-muted)",
      }}
    >
      {category}
    </span>
  );
}

// ── Loading / error / empty states ─────────────────────────────────

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2 max-w-4xl" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="rounded border p-3 animate-pulse h-16"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface-muted)",
          }}
        />
      ))}
    </ul>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="rounded border p-3 max-w-4xl"
      role="alert"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <p className="text-red-600 text-sm">{message}</p>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div
      className="rounded border p-6 max-w-4xl text-center"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <Brain
        size={20}
        aria-hidden="true"
        style={{ color: "var(--color-text-muted)" }}
        className="mx-auto mb-2"
      />
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {filtered
          ? "No matches for these filters."
          : "No memory entries yet."}
      </p>
    </div>
  );
}
