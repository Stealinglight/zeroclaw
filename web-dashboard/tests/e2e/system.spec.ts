/**
 * System page smoke (M5.1, US-004).
 *
 * Stands alone: Vite dev server with route-mocked /api/status and
 * /api/cost. Mocks reflect the wire shape of handle_api_status and
 * handle_api_cost in crates/zeroclaw-gateway/src/api.rs.
 *
 * Coverage:
 *   1. /system renders header + the three cards (Gateway status,
 *      Components, Cost).
 *   2. Status card shows formatted uptime, memory backend, channel
 *      summary derived from the mock.
 *   3. Cost card shows monthly USD with 4 decimals.
 *   4. Component health table renders one row per components map
 *      entry, with the raw status string and restart_count.
 *   5. SectionNav marks /system active.
 */
import { test, expect } from "@playwright/test";

const BOOTSTRAP_BODY = {
  server_version: "0.0.0-test",
  assistant_identity: { name: "ZeroClaw" },
  themes: { default_theme: "default", default_mode: "dark" },
  max_chat_width_ch: 80,
};

const STATUS_BODY = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  temperature: 0.7,
  uptime_seconds: 3725, // 1h 2m 5s
  gateway_port: 42617,
  locale: "en-US",
  memory_backend: "sqlite",
  paired: true,
  channels: { telegram: true, slack: false, twilio: true },
  health: {
    pid: 12345,
    updated_at: "2026-05-16T10:00:00Z",
    uptime_seconds: 3725,
    components: {
      "channels/telegram": {
        status: "ok",
        updated_at: "2026-05-16T10:00:00Z",
        last_ok: "2026-05-16T10:00:00Z",
        last_error: null,
        restart_count: 0,
      },
      "providers/anthropic": {
        status: "warning",
        updated_at: "2026-05-16T09:55:00Z",
        last_ok: "2026-05-16T09:50:00Z",
        last_error: "Rate limited",
        restart_count: 2,
      },
    },
  },
};

const COST_BODY = {
  cost: {
    session_cost_usd: 0.0123,
    daily_cost_usd: 0.4567,
    monthly_cost_usd: 12.3456,
    total_tokens: 123456,
    request_count: 42,
    by_model: {
      "claude-sonnet-4-6": {
        cost_usd: 10.0,
        total_tokens: 100000,
        request_count: 30,
      },
      "claude-haiku-4-5": {
        cost_usd: 2.3456,
        total_tokens: 23456,
        request_count: 12,
      },
    },
  },
};

async function mockGateway(page: import("@playwright/test").Page) {
  await page.route("**/api/control-ui/config", (route) =>
    route.fulfill({ json: BOOTSTRAP_BODY }),
  );
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: STATUS_BODY }),
  );
  await page.route("**/api/cost", (route) =>
    route.fulfill({ json: COST_BODY }),
  );
}

test("system page renders the three cards", async ({ page }) => {
  await mockGateway(page);

  await page.goto("/system");

  await expect(
    page.getByRole("heading", { level: 1, name: "System" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Gateway status" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Components" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Cost" }),
  ).toBeVisible();
});

test("status card renders uptime, memory backend, and channel summary", async ({
  page,
}) => {
  await mockGateway(page);

  await page.goto("/system");

  // 3725s → 1h 2m
  await expect(page.getByText("1h 2m")).toBeVisible();
  await expect(page.getByText("sqlite")).toBeVisible();
  // 2 active out of 3 channels (telegram + twilio = true, slack = false)
  await expect(page.getByText(/2 active \/ 3 configured/)).toBeVisible();
});

test("component health table renders one row per component", async ({
  page,
}) => {
  await mockGateway(page);

  await page.goto("/system");

  await expect(page.getByText("channels/telegram")).toBeVisible();
  await expect(page.getByText("providers/anthropic")).toBeVisible();

  // restart_count=2 for providers/anthropic should appear in the row.
  // Scope to the table cell to avoid matching unrelated "2" elsewhere.
  const anthropicRow = page
    .getByRole("row")
    .filter({ has: page.getByText("providers/anthropic") });
  await expect(anthropicRow.getByText("2", { exact: true })).toBeVisible();
});

test("cost card shows monthly USD with 4 decimals", async ({ page }) => {
  await mockGateway(page);

  await page.goto("/system");

  // 12.3456 → "$12.3456"
  await expect(page.getByText("$12.3456")).toBeVisible();

  // Scope by_model assertions to the Cost card — the status card also
  // renders the active model "claude-sonnet-4-6" so a global getByText
  // matches twice and trips strict-mode.
  const costCard = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Cost" }) });
  await expect(costCard.getByText("claude-sonnet-4-6")).toBeVisible();
  await expect(costCard.getByText("claude-haiku-4-5")).toBeVisible();
});

test("section nav marks System active on /system", async ({ page }) => {
  await mockGateway(page);

  await page.goto("/system");

  const systemLink = page.getByRole("link", { name: "System" });
  await expect(systemLink.first()).toHaveAttribute("aria-current", "page");
});
