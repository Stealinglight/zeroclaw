/**
 * React Query hooks for the System page (M5.1, US-001 + US-002).
 *
 * /api/status already embeds the full health snapshot, so the System
 * page consumes /api/status (uptime + provider config + channels +
 * health) plus /api/cost (cost summary). This avoids the extra round-
 * trip the plan §5 mentioned for /api/health.
 *
 * Backend contracts:
 *   GET /api/status → see crates/zeroclaw-gateway/src/api.rs
 *                     handle_api_status — provider, model, uptime,
 *                     channels, health (HealthSnapshot).
 *   GET /api/cost   → { cost: CostSummary }
 *                     CostSummary fields enumerated by the backend's
 *                     cost-tracker module.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/apiFetch";

// ── Health (embedded in /api/status) ───────────────────────────────

export interface ComponentHealth {
  status: string;
  updated_at: string;
  last_ok?: string | null;
  last_error?: string | null;
  restart_count: number;
}

export interface HealthSnapshot {
  pid: number;
  updated_at: string;
  uptime_seconds: number;
  components: Record<string, ComponentHealth>;
}

// ── Status ─────────────────────────────────────────────────────────

export interface StatusResponse {
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
  uptime_seconds: number;
  gateway_port: number;
  locale: string;
  memory_backend: string;
  paired: boolean;
  channels: Record<string, boolean>;
  health: HealthSnapshot;
}

export const STATUS_QUERY_KEY = ["system", "status"] as const;

export function useStatusQuery() {
  return useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => apiFetch<StatusResponse>("/api/status"),
    // Status changes on daemon reload; component health updates more
    // often. 10s keeps the page reasonably fresh without spamming.
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

// ── Cost ───────────────────────────────────────────────────────────

export interface ModelStats {
  model: string;
  cost_usd: number;
  total_tokens: number;
  request_count: number;
}

export interface CostSummary {
  session_cost_usd: number;
  daily_cost_usd: number;
  monthly_cost_usd: number;
  total_tokens: number;
  request_count: number;
  by_model: Record<string, ModelStats>;
}

export interface CostResponse {
  cost: CostSummary;
}

export const COST_QUERY_KEY = ["system", "cost"] as const;

export function useCostQuery() {
  return useQuery({
    queryKey: COST_QUERY_KEY,
    queryFn: () => apiFetch<CostResponse>("/api/cost"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Formats a duration in seconds as "Xd Yh", "Yh Zm", or "Zm Ws"
 * depending on magnitude. Stays compact for a status pill display.
 */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/**
 * Counts active vs configured channels. The /api/status response maps
 * channel names to bool — true means "configured", false means
 * "not configured for this gateway."
 */
export function countActiveChannels(
  channels: Record<string, boolean>,
): { active: number; total: number } {
  const entries = Object.values(channels);
  return {
    active: entries.filter(Boolean).length,
    total: entries.length,
  };
}
