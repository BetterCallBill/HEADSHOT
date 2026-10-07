// A private deployment (SITE_NOINDEX=true) stays out of search engines: robots.txt disallows everything
// and every api answer, whichever route wrote it, says noindex, nofollow. The modules this fork does not
// use are switched off, so their pages and schedules are gone.
import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { FEATURES } from "@aihot/industry/features";

// The backend reads its configuration on first import, so the switch is set before any of it loads.
process.env.SITE_NOINDEX = "true";
const { closeDb } = await import("@aihot/backend/db");
const { buildApp } = await import("../apps/api/src/app.ts");
const { SCHEDULES } = await import("../apps/worker/src/schedules.ts");
const app = await buildApp();
after(async () => {
  await app.close();
  await closeDb();
});

test("robots.txt disallows the whole site and names no sitemap", async () => {
  const r = await app.inject("/robots.txt");
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, "User-agent: *\nDisallow: /\n");
  assert.equal(r.headers["x-robots-tag"], "noindex, nofollow");
});

test("every api answer says noindex, nofollow, errors included", async () => {
  for (const url of ["/api/health", "/api/v1/agent", "/feed.xml", "/api/v1/no-such-route"]) {
    const r = await app.inject(url);
    assert.equal(r.headers["x-robots-tag"], "noindex, nofollow", url);
  }
});

test("the leaderboard and the Codex reset monitor are off: no routes, no schedules", async () => {
  assert.equal(FEATURES.leaderboard, false);
  assert.equal(FEATURES.codexResetMonitor, false);
  assert.equal((await app.inject("/api/leaderboard/latest")).statusCode, 404);
  assert.ok(!SCHEDULES.some((s) => s.name.startsWith("leaderboard.") || s.name.startsWith("monitor.")));
});
