/**
 * System page (M5.1, US-001 + US-002 + US-003).
 *
 * Renders runtime configuration and health from /api/status and cost
 * summary from /api/cost. Auto-refreshes every 10s for status and 30s
 * for cost so users watching the page see live deltas without manual
 * reload.
 *
 * Layout (vertical stack):
 *   1. Status card — provider, model, uptime, locale, memory backend,
 *      gateway port, paired flag, channel summary.
 *   2. Component health table — rows from health.components Map.
 *   3. Cost card — session/daily/monthly USD, tokens, requests,
 *      optional by-model breakdown.
 *
 * Strings inline per M3/M4/M5.0 convention; localisation deferred to
 * M7 per plan §5.
 */
import { Activity, AlertTriangle, CheckCircle2, Clock, DollarSign } from "lucide-react";
import { useControlUiBootstrap } from "@/app/ControlUiBootstrapProvider";
import { SectionNav } from "@/app/SectionNav";
import { ThemeSwitcher } from "@/theme/ThemeSwitcher";
import {
  countActiveChannels,
  formatUptime,
  useCostQuery,
  useStatusQuery,
  type ComponentHealth,
} from "@/system/systemQueries";

export function SystemPage() {
  const bootstrap = useControlUiBootstrap();

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
        <h1 className="text-base font-semibold mb-3">System</h1>
        <p
          className="text-sm mb-6 max-w-2xl"
          style={{ color: "var(--color-text-muted)" }}
        >
          Live gateway status, component health, and cost roll-up.
          Auto-refreshes while this tab is open.
        </p>
        <div className="flex flex-col gap-4 max-w-4xl">
          <StatusCard />
          <HealthTable />
          <CostCard />
        </div>
      </main>
    </div>
  );
}

// ── Status card ────────────────────────────────────────────────────

function StatusCard() {
  const { data, isLoading, error } = useStatusQuery();

  return (
    <Card title="Gateway status" icon={Activity}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <ErrorBlock message={String(error)} />
      ) : data ? (
        <StatusGrid status={data} />
      ) : null}
    </Card>
  );
}

function StatusGrid({ status }: { status: ReturnType<typeof useStatusQuery>["data"] & {} }) {
  const channels = countActiveChannels(status.channels);
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
      style={{ color: "var(--color-text)" }}
    >
      <Row term="Uptime" def={formatUptime(status.uptime_seconds)} />
      <Row term="Provider" def={status.provider ?? "—"} />
      <Row term="Model" def={status.model ?? "—"} />
      {typeof status.temperature === "number" ? (
        <Row term="Temperature" def={status.temperature.toFixed(2)} />
      ) : null}
      <Row term="Memory backend" def={status.memory_backend} />
      <Row term="Locale" def={status.locale} />
      <Row term="Gateway port" def={String(status.gateway_port)} />
      <Row
        term="Channels"
        def={`${channels.active} active / ${channels.total} configured`}
      />
      <Row
        term="Paired"
        def={
          <span
            className="inline-flex items-center gap-1"
            style={{
              color: status.paired
                ? "var(--color-text)"
                : "var(--color-text-muted)",
            }}
          >
            {status.paired ? (
              <>
                <CheckCircle2 size={12} aria-hidden="true" /> yes
              </>
            ) : (
              <>
                <AlertTriangle size={12} aria-hidden="true" /> no
              </>
            )}
          </span>
        }
      />
    </dl>
  );
}

function Row({ term, def }: { term: string; def: React.ReactNode }) {
  return (
    <>
      <dt
        className="text-xs uppercase tracking-wide"
        style={{ color: "var(--color-text-muted)" }}
      >
        {term}
      </dt>
      <dd className="tabular-nums">{def}</dd>
    </>
  );
}

// ── Component health table ─────────────────────────────────────────

function HealthTable() {
  const { data, isLoading, error } = useStatusQuery();
  const components = data?.health.components;

  return (
    <Card title="Components" icon={Clock}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <ErrorBlock message={String(error)} />
      ) : !components || Object.keys(components).length === 0 ? (
        <p
          className="text-sm"
          style={{ color: "var(--color-text-muted)" }}
        >
          No components reporting health yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr style={{ color: "var(--color-text-muted)" }}>
                <th className="text-left text-xs uppercase tracking-wide pb-2">Name</th>
                <th className="text-left text-xs uppercase tracking-wide pb-2">Status</th>
                <th className="text-left text-xs uppercase tracking-wide pb-2">Updated</th>
                <th className="text-right text-xs uppercase tracking-wide pb-2">Restarts</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(components).map(([name, c]) => (
                <ComponentRow key={name} name={name} component={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ComponentRow({
  name,
  component,
}: {
  name: string;
  component: ComponentHealth;
}) {
  // Backend serialises status as a free-form string. "ok" / "ready" /
  // "running" indicate healthy; anything else is treated as warning
  // for the icon. Display the raw status string verbatim.
  const status = component.status.toLowerCase();
  const healthy = status === "ok" || status === "ready" || status === "running";
  return (
    <tr style={{ borderTop: "1px solid var(--color-border)" }}>
      <td className="py-1 pr-4 font-medium">{name}</td>
      <td className="py-1 pr-4">
        <span
          className="inline-flex items-center gap-1"
          style={{
            color: healthy ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          {healthy ? (
            <CheckCircle2 size={12} aria-hidden="true" />
          ) : (
            <AlertTriangle size={12} aria-hidden="true" />
          )}
          {component.status}
        </span>
      </td>
      <td
        className="py-1 pr-4"
        style={{ color: "var(--color-text-muted)" }}
        title={component.last_error ?? undefined}
      >
        {component.updated_at}
      </td>
      <td className="py-1 text-right tabular-nums">
        {component.restart_count}
      </td>
    </tr>
  );
}

// ── Cost card ──────────────────────────────────────────────────────

function CostCard() {
  const { data, isLoading, error } = useCostQuery();

  return (
    <Card title="Cost" icon={DollarSign}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <ErrorBlock message={String(error)} />
      ) : data ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <Row term="Session" def={`$${data.cost.session_cost_usd.toFixed(4)}`} />
            <Row term="Today" def={`$${data.cost.daily_cost_usd.toFixed(4)}`} />
            <Row term="This month" def={`$${data.cost.monthly_cost_usd.toFixed(4)}`} />
            <Row term="Tokens" def={data.cost.total_tokens.toLocaleString()} />
            <Row term="Requests" def={data.cost.request_count.toLocaleString()} />
          </dl>
          <ByModelList by_model={data.cost.by_model} />
        </div>
      ) : null}
    </Card>
  );
}

function ByModelList({ by_model }: { by_model: Record<string, number> }) {
  const entries = Object.entries(by_model);
  if (entries.length === 0) return null;
  return (
    <div>
      <h3
        className="text-xs uppercase tracking-wide mb-1"
        style={{ color: "var(--color-text-muted)" }}
      >
        By model
      </h3>
      <ul className="text-sm flex flex-col gap-0.5">
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([model, cost]) => (
            <li
              key={model}
              className="flex items-center justify-between tabular-nums"
            >
              <span>{model}</span>
              <span style={{ color: "var(--color-text-muted)" }}>
                ${cost.toFixed(4)}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

// ── Card primitives ────────────────────────────────────────────────

interface CardProps {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
}

function Card({ title, icon: Icon, children }: CardProps) {
  return (
    <article
      className="rounded border p-4 flex flex-col gap-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      <header className="flex items-center gap-2">
        <Icon size={14} aria-hidden="true" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div>{children}</div>
    </article>
  );
}

function Skeleton() {
  return (
    <div
      className="animate-pulse h-16 rounded"
      style={{ background: "var(--color-surface-muted)" }}
      aria-label="Loading"
    />
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="text-red-600 text-xs" role="alert">
      {message}
    </p>
  );
}
