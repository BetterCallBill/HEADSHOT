// The site's calendar follows SITE.timeZone, daylight saving included: a day ends at the next day's
// midnight (23 or 25 hours on the days the clocks change), the daily report's window is read on the
// clock at both ends, and the worker's crons fire in that zone. Sydney changes on Sunday 4 October 2026
// (AEST +10 → AEDT +11, a 23-hour day) and Sunday 4 April 2027 (back to +10, a 25-hour day).
import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { SITE } from "@aihot/industry/site";
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { dailyWindow, dueDaily } from "@aihot/backend/reports/compose";
import { countTimelineDays } from "@aihot/backend/publication/timeline";
import { parseLooseDate } from "@aihot/backend/sources/web-list";
import { addDays, BEIJING, siteDate, siteMidnight, zonedDate, zonedInstant, zonedIso, zonedTime, zoneOffsetMs } from "@aihot/contracts/time";
import { registerSchedules, SCHEDULES } from "../apps/worker/src/schedules.ts";

after(async () => {
  await stopBoss();
  await closeDb();
});

const SYDNEY = "Australia/Sydney";
const HOUR = 3600_000;
const midnight = (date: string, zone: string) => zonedInstant(date, "00:00", zone);
const dayLength = (date: string, zone: string) => (midnight(addDays(date, 1), zone).getTime() - midnight(date, zone).getTime()) / HOUR;

test("this fork runs on Sydney time with the daily report at 07:00", () => {
  assert.equal(SITE.timeZone, SYDNEY);
  assert.equal(SITE.dailyReportHour, 7);
});

test("an ordinary day is 24 hours in both zones, and the date and time are read on each clock", () => {
  assert.equal(dayLength("2026-09-15", BEIJING), 24);
  assert.equal(dayLength("2026-09-15", SYDNEY), 24);
  const at = new Date("2026-09-15T02:30:00Z");
  assert.equal(zonedDate(at, BEIJING), "2026-09-15");
  assert.equal(zonedTime(at, BEIJING), "10:30");
  assert.equal(zonedTime(at, SYDNEY), "12:30");
  assert.equal(midnight("2026-09-15", BEIJING).toISOString(), "2026-09-14T16:00:00.000Z");
  assert.equal(midnight("2026-09-15", SYDNEY).toISOString(), "2026-09-14T14:00:00.000Z");
});

test("Sydney's clock change days are 23 and 25 hours long; Beijing has none", () => {
  assert.equal(dayLength("2026-10-04", SYDNEY), 23);
  assert.equal(dayLength("2027-04-04", SYDNEY), 25);
  assert.equal(dayLength("2026-10-04", BEIJING), 24);
  assert.equal(dayLength("2027-04-04", BEIJING), 24);
  assert.equal(zoneOffsetMs("2026-10-03T12:00:00Z", SYDNEY), 10 * HOUR);
  assert.equal(zoneOffsetMs("2026-10-04T12:00:00Z", SYDNEY), 11 * HOUR);
  assert.equal(zonedIso("2026-10-03T23:00:00Z", SYDNEY), "2026-10-04T10:00:00+11:00");
  assert.equal(zonedIso("2026-06-01T00:00:00Z", SYDNEY), "2026-06-01T10:00:00+10:00");
  assert.equal(zonedIso("2026-06-01T00:00:00Z", BEIJING), "2026-06-01T08:00:00+08:00");
});

test("the hour around each change maps to the right local date", () => {
  // 02:00 AEST on 4 Oct jumps to 03:00 AEDT: 15:59:59Z is 01:59:59, 16:00:00Z is 03:00:00.
  assert.equal(zonedTime("2026-10-03T15:59:00Z", SYDNEY), "01:59");
  assert.equal(zonedTime("2026-10-03T16:00:00Z", SYDNEY), "03:00");
  // 03:00 AEDT on 4 Apr falls back to 02:00 AEST: 02:30 happens twice, both on the 4th.
  assert.equal(zonedTime("2027-04-03T15:30:00Z", SYDNEY), "02:30");
  assert.equal(zonedTime("2027-04-03T16:30:00Z", SYDNEY), "02:30");
  assert.equal(zonedDate("2027-04-03T16:30:00Z", SYDNEY), "2027-04-04");
});

test("month and year boundaries fall on each zone's own midnight", () => {
  assert.equal(zonedDate("2026-10-31T13:30:00Z", SYDNEY), "2026-11-01");
  assert.equal(zonedDate("2026-10-31T13:30:00Z", BEIJING), "2026-10-31");
  assert.equal(zonedDate("2026-12-31T13:00:00Z", SYDNEY), "2027-01-01");
  assert.equal(zonedDate("2026-12-31T12:59:59Z", SYDNEY), "2026-12-31");
  assert.equal(siteDate("2026-12-31T13:00:00Z"), "2027-01-01");
  assert.equal(siteMidnight("2027-01-01").toISOString(), "2026-12-31T13:00:00.000Z");
});

test("the daily window is read on the clock: 23 hours on 4 Oct 2026, 25 on 4 Apr 2027, no gaps", () => {
  const hours = (date: string) => {
    const w = dailyWindow(date);
    return (w.end.getTime() - w.start.getTime()) / HOUR;
  };
  assert.equal(dailyWindow("2026-10-04").start.toISOString(), "2026-10-02T21:00:00.000Z"); // 07:00 AEST on the 3rd
  assert.equal(dailyWindow("2026-10-04").end.toISOString(), "2026-10-03T20:00:00.000Z"); // 07:00 AEDT on the 4th
  assert.equal(hours("2026-10-03"), 24);
  assert.equal(hours("2026-10-04"), 23);
  assert.equal(hours("2026-10-05"), 24);
  assert.equal(hours("2027-04-04"), 25);
  for (const date of ["2026-10-04", "2026-10-05", "2027-04-04", "2027-04-05"]) {
    assert.equal(dailyWindow(date).start.getTime(), dailyWindow(addDays(date, -1)).end.getTime(), `${date} starts where the day before ended`);
  }
});

test("a daily is due from 07:00 on the site's clock", () => {
  assert.equal(dueDaily(new Date("2026-10-03T20:00:05Z")), "2026-10-04"); // 07:00:05 AEDT
  assert.equal(dueDaily(new Date("2026-10-03T19:59:00Z")), "2026-10-03"); // 06:59 AEDT
  assert.equal(dueDaily(new Date("2026-10-03T14:00:00Z")), "2026-10-03", "after midnight, before 07:00: still yesterday's");
});

test("timeline day counts use the real day length on a clock change day", () => {
  const start = siteMidnight("2026-10-04").getTime();
  const end = siteMidnight("2026-10-05").getTime();
  // Newest first: one just inside the end of the 23-hour day, one at its start, one just before it.
  const grouped = [{ anchor: end - 1 }, { anchor: start }, { anchor: start - 1 }];
  assert.deepEqual(countTimelineDays(grouped, new Set(["2026-10-03", "2026-10-04"])), { "2026-10-03": 1, "2026-10-04": 2 });
});

test("a list page date without a zone is read on the site's clock unless the source sets an offset", () => {
  assert.equal(parseLooseDate("2026-10-04 10:00")?.toISOString(), "2026-10-03T23:00:00.000Z"); // AEDT
  assert.equal(parseLooseDate("2026-09-26 10:00")?.toISOString(), "2026-09-26T00:00:00.000Z"); // AEST
  assert.equal(parseLooseDate("2026-09-26 10:00", "+08:00")?.toISOString(), "2026-09-26T02:00:00.000Z");
});

test("the worker registers its crons in the site's zone, the daily at the daily hour", async () => {
  assert.equal(SCHEDULES.find((s) => s.name === "reports.daily")?.cron, "0 7 * * *");
  const scheduled: Array<{ name: string; cron: string; tz?: string }> = [];
  const boss = {
    schedule: async (name: string, cron: string, _data: unknown, options: { tz?: string }) => void scheduled.push({ name, cron, tz: options.tz }),
    work: async () => "worker",
    getSchedules: async () => [],
    unschedule: async () => {},
  };
  await registerSchedules(boss as never);
  assert.ok(scheduled.length > 0);
  assert.ok(scheduled.every((s) => s.tz === SYDNEY));
  assert.deepEqual(scheduled.find((s) => s.name === "cron.reports.daily"), { name: "cron.reports.daily", cron: "0 7 * * *", tz: SYDNEY });
});
