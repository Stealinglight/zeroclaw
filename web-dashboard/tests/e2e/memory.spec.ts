/**
 * Memory page smoke (M5.2, US-004).
 *
 * Stands alone: Vite dev server with route-mocked /api/memory. Mocks
 * reflect the wire shape of handle_api_memory_list /
 * handle_api_memory_delete in crates/zeroclaw-gateway/src/api.rs and
 * the MemoryEntry struct from crates/zeroclaw-api/src/memory_traits.rs.
 *
 * Coverage:
 *   1. /memory renders header + entries from mocked GET /api/memory.
 *   2. Section nav marks /memory active.
 *   3. Empty state renders when API returns [].
 *   4. Category filter re-fetches with ?category=core.
 *   5. Search input debounces and re-fetches with ?query=foo.
 *   6. Delete button removes the row after confirm + DELETE call.
 *   7. Failing /api/memory surfaces an error banner.
 */
import { test, expect } from "@playwright/test";

const BOOTSTRAP_BODY = {
  server_version: "0.0.0-test",
  assistant_identity: { name: "ZeroClaw" },
  themes: { default_theme: "default", default_mode: "dark" },
  max_chat_width_ch: 80,
};

const MEMORY_BODY = {
  entries: [
    {
      id: "id-1",
      key: "fav_color",
      content: "blue",
      category: "core",
      timestamp: "2026-05-15T10:00:00Z",
      session_id: null,
      score: null,
      namespace: "default",
      importance: 0.85,
      superseded_by: null,
    },
    {
      id: "id-2",
      key: "morning_routine",
      content: "coffee, then code",
      category: "daily",
      timestamp: "2026-05-15T09:00:00Z",
      session_id: null,
      score: null,
      namespace: "default",
      importance: null,
      superseded_by: null,
    },
  ],
};

async function mockBootstrap(page: import("@playwright/test").Page) {
  await page.route("**/api/control-ui/config", (route) =>
    route.fulfill({ json: BOOTSTRAP_BODY }),
  );
}

test("memory page renders entries from /api/memory", async ({ page }) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ json: MEMORY_BODY }),
  );

  await page.goto("/memory");

  await expect(
    page.getByRole("heading", { level: 1, name: "Memory" }),
  ).toBeVisible();

  // Both entries' keys render verbatim.
  await expect(page.getByText("fav_color")).toBeVisible();
  await expect(page.getByText("morning_routine")).toBeVisible();

  // Content previews.
  await expect(page.getByText("blue")).toBeVisible();
  await expect(page.getByText("coffee, then code")).toBeVisible();

  // Importance is rendered for entries that carry it (fav_color: 0.85),
  // omitted for entries that don't (morning_routine: null importance).
  await expect(page.getByText(/importance 0\.85/)).toBeVisible();
});

test("section nav marks Memory active on /memory", async ({ page }) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ json: MEMORY_BODY }),
  );

  await page.goto("/memory");

  const memoryLink = page.getByRole("link", { name: "Memory" });
  await expect(memoryLink.first()).toHaveAttribute("aria-current", "page");
});

test("empty state renders when API returns no entries", async ({ page }) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );

  await page.goto("/memory");

  await expect(page.getByText("No memory entries yet.")).toBeVisible();
});

test("category filter re-fetches with ?category=core", async ({ page }) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ json: MEMORY_BODY }),
  );

  await page.goto("/memory");

  // Wait for initial render so we know the filter row is in the DOM.
  await expect(page.getByText("fav_color")).toBeVisible();

  // Selecting "core" should fire a new request that includes
  // ?category=core. Race the request listener against the change.
  const requestPromise = page.waitForRequest(
    (req) => req.url().includes("/api/memory") && req.url().includes("category=core"),
  );
  await page.getByLabel("Filter by category").selectOption("core");
  await requestPromise;
});

test("search input debounces and re-fetches with ?query=blue", async ({
  page,
}) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ json: MEMORY_BODY }),
  );

  await page.goto("/memory");
  await expect(page.getByText("fav_color")).toBeVisible();

  const requestPromise = page.waitForRequest(
    (req) => req.url().includes("/api/memory") && req.url().includes("query=blue"),
  );
  await page.getByLabel("Search memory").fill("blue");
  await requestPromise;
});

test("delete button removes the row after confirm + DELETE", async ({
  page,
}) => {
  await mockBootstrap(page);

  // Two-phase mock: list endpoint returns full set first, then the
  // empty set after the delete completes. We track the DELETE arrival
  // by toggling state in the test.
  let deleted = false;
  await page.route("**/api/memory", (route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        json: deleted
          ? { entries: MEMORY_BODY.entries.filter((e) => e.key !== "fav_color") }
          : MEMORY_BODY,
      });
    } else {
      route.continue();
    }
  });
  await page.route("**/api/memory/fav_color", (route) => {
    if (route.request().method() === "DELETE") {
      deleted = true;
      route.fulfill({ json: { status: "ok", deleted: true } });
    } else {
      route.continue();
    }
  });

  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/memory");

  // Scope every assertion to the entries list — the success toast also
  // mentions the deleted key, so a global getByText would match the
  // toast and break the "not visible" check.
  const list = page.getByRole("list", { name: "Memory entries" });
  await expect(list.getByText("fav_color")).toBeVisible();

  await page
    .getByRole("button", { name: "Delete memory fav_color" })
    .click();

  // After invalidation refetch the list — fav_color should be gone,
  // morning_routine should remain.
  await expect(list.getByText("fav_color")).not.toBeVisible();
  await expect(list.getByText("morning_routine")).toBeVisible();
});

test("failing /api/memory surfaces an error banner", async ({ page }) => {
  await mockBootstrap(page);
  await page.route("**/api/memory*", (route) =>
    route.fulfill({ status: 500, body: "boom" }),
  );

  await page.goto("/memory");

  // Filter row should still render even when the list errors.
  await expect(page.getByLabel("Filter by category")).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
});
