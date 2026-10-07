// Calendar helpers shared by web and backend, in the site's time zone (SITE.timeZone in industry/site.ts).
// A zone with daylight saving has 23- and 25-hour days, so a day ends at the next day's midnight, never
// at its midnight + 24 h. The beijing* names are older aliases of the site* helpers, kept so upstream
// callers and merges need no edits; code that must stay on Beijing time passes BEIJING to the zoned* ones.
import { SITE } from "@aihot/industry/site";

export const BEIJING = "Asia/Shanghai";

const FORMATS = new Map<string, Intl.DateTimeFormat>();

interface WallClock { year: string; month: string; day: string; hour: string; minute: string; second: string }

function wallClock(t: number, zone: string): WallClock {
  let f = FORMATS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    FORMATS.set(zone, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(t)) p[type] = value;
  // A wall time past the Date range (the last representable instant, read ahead of UTC) is as unusable
  // as an invalid instant: callers that validate dates by formatting them rely on the throw.
  if (!Number.isFinite(Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!))) throw new RangeError("Invalid time value");
  return p as unknown as WallClock;
}

/** How far the zone's clock is ahead of UTC at the instant, in ms (+11 h in a Sydney summer). */
export function zoneOffsetMs(instant: Date | string | number, zone: string): number {
  const t = Math.floor(new Date(instant).getTime() / 1000) * 1000;
  const w = wallClock(t, zone);
  return Date.UTC(+w.year, +w.month - 1, +w.day, +w.hour, +w.minute, +w.second) - t;
}

/** YYYY-MM-DD of the instant in the zone. */
export function zonedDate(instant: Date | string | number, zone: string): string {
  const w = wallClock(new Date(instant).getTime(), zone);
  return `${w.year}-${w.month}-${w.day}`;
}

/** HH:mm of the instant in the zone. */
export function zonedTime(instant: Date | string | number, zone: string): string {
  const w = wallClock(new Date(instant).getTime(), zone);
  return `${w.hour}:${w.minute}`;
}

/** The instant the zone's clock reads `time` (HH:mm or HH:mm:ss) on `date`. */
export function zonedInstant(date: string, time: string, zone: string): Date {
  const wall = Date.parse(`${date}T${time}Z`);
  if (!Number.isFinite(wall)) return new Date(NaN);
  // The offset at the wall time read as UTC can be the other side of a clock change; the second pass
  // takes it at the instant the first one found.
  const first = wall - zoneOffsetMs(wall, zone);
  return new Date(wall - zoneOffsetMs(first, zone));
}

/** RFC 3339 with the zone's offset at that instant: "2026-10-04T09:30:00+11:00". */
export function zonedIso(instant: Date | string | number, zone: string): string {
  const t = new Date(instant).getTime();
  const w = wallClock(t, zone);
  const off = Math.round(zoneOffsetMs(t, zone) / 60_000);
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${w.year}-${w.month}-${w.day}T${w.hour}:${w.minute}:${w.second}${off < 0 ? "-" : "+"}${hh}:${mm}`;
}

/** YYYY-MM-DD of the instant in the site's zone. */
export function siteDate(instant: Date | string | number): string {
  return zonedDate(instant, SITE.timeZone);
}

/** HH:mm of the instant in the site's zone. */
export function siteTime(instant: Date | string | number): string {
  return zonedTime(instant, SITE.timeZone);
}

/** UTC instant of 00:00 in the site's zone on the given calendar day. */
export function siteMidnight(date: string): Date {
  return zonedInstant(date, "00:00", SITE.timeZone);
}

/** UTC instant the site's clock reads `time` (HH:mm) on the given calendar day. */
export function siteAt(date: string, time: string): Date {
  return zonedInstant(date, time, SITE.timeZone);
}

/** Formats an instant as RFC 3339 with the site zone's offset at that instant. */
export function toSiteIso(instant: Date | string | number): string {
  return zonedIso(instant, SITE.timeZone);
}

/** "07:00": the daily report's hour in the site's zone, as readers see it. */
export const DAILY_REPORT_TIME = `${String(SITE.dailyReportHour).padStart(2, "0")}:00`;

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** Weekday of a calendar date (the same in every zone). */
export function siteWeekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** @deprecated The site's zone, despite the name; use siteDate. */
export const beijingDate = siteDate;
/** @deprecated The site's zone, despite the name; use siteTime. */
export const beijingTime = siteTime;
/** @deprecated The site's zone, despite the name; use siteMidnight. */
export const beijingMidnight = siteMidnight;
/** @deprecated Use siteWeekday. */
export const beijingWeekday = siteWeekday;
/** @deprecated The site's zone, despite the name; use toSiteIso. */
export const toBeijingIso = toSiteIso;

/** ISO week label (e.g. 2026-W38) of a calendar date. */
export function isoWeekLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday..Sunday calendar dates of an ISO week label. */
export function isoWeekRange(label: string): { start: string; end: string } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const start = new Date(mondayWeek1);
  start.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const startDate = start.toISOString().slice(0, 10);
  if (isoWeekLabel(startDate) !== label) return null;
  return { start: startDate, end: addDays(startDate, 6) };
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === date;
}

/** First and last calendar dates of a real YYYY-MM month. */
export function monthRange(label: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(label) || !isValidDate(`${label}-01`)) return null;
  const month = Number(label.slice(5));
  const end = new Date(`${label}-01T00:00:00Z`);
  end.setUTCMonth(month);
  end.setUTCDate(0);
  return { start: `${label}-01`, end: end.toISOString().slice(0, 10) };
}
