// Shared by the shop, checkout and Stripe. Cutoffs always use UK time.
export const DISPATCH_TIME_ZONE = "Europe/London";
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DISPATCH_DAYS = [1, 4];
export const CUTOFF_HOUR = 21;
const DAY_MS = 86_400_000;

// Refresh annually. Operational exclusions also include courier backlog days.
// This selects the FIRST dispatch. Existing renewals are managed in Stripe.
export const BLOCKED_DISPATCH = new Set([
  "2026-12-24", "2026-12-28", "2026-12-31",
  "2027-03-25", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30",
  "2027-12-27", "2028-01-03", "2028-04-13", "2028-04-17",
  "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2029-01-01",
]);
const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPATCH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
export function toISODate(date: Date): string {
  const parts = Object.fromEntries(londonFormatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// UTC noon calendar arithmetic avoids DST changes and browser timezone effects.
export function addCalendarDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function weekdayFromISO(iso: string): string {
  return DAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()] || "";
}
export function formatDateUK(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  return iso.split("-").reverse().join("/");
}
export function formatDispatchDate(iso: string): string {
  return `${formatDateUK(iso)} (${weekdayFromISO(iso)})`;
}
function findNextDispatch(now: Date, skipBlocked: boolean): string {
  const parts = Object.fromEntries(londonFormatter.formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  for (let days = 1; days <= 60; days++) {
    const candidate = addCalendarDays(today, days);
    if (!DISPATCH_DAYS.includes(new Date(`${candidate}T12:00:00Z`).getUTCDay())) continue;
    const cutoffDate = addCalendarDays(candidate, -2);
    if (today > cutoffDate || (today === cutoffDate && Number(parts.hour) >= CUTOFF_HOUR)) continue;
    if (skipBlocked && BLOCKED_DISPATCH.has(candidate)) continue;
    return candidate;
  }
  throw new Error("No available dispatch date in the next 60 days");
}
export function nextDispatchISO(now = new Date()): string {
  return findNextDispatch(now, true);
}
export function nextSubscriptionISO(now = new Date()): string {
  return nextDispatchISO(now);
}
export function dispatchDelayed(_mode: "oneoff" | "subscription", now = new Date()): boolean {
  return findNextDispatch(now, true) !== findNextDispatch(now, false);
}
export function holidayListNeedsRefresh(now = new Date()): boolean {
  return toISODate(now) > ([...BLOCKED_DISPATCH].sort().pop() || "");
}
export function subscriptionSchedule(now = new Date()) {
  const dispatchISO = nextDispatchISO(now);
  // Preserve evening billing at 21:00 UTC (21:00 winter / 22:00 summer).
  // A one-minute safety margin at the cutoff allows for Stripe request latency
  // without moving the first dispatch or changing the selected weekday.
  const trialEnd = Math.max(
    Math.floor(Date.parse(`${dispatchISO}T21:00:00Z`) / 1000),
    Math.floor(now.getTime() / 1000) + 48 * 3600 + 60,
  );
  return { dispatchISO, weekday: weekdayFromISO(dispatchISO), trialEnd };
}
export function subscriptionDispatchDetails(
  metadata: Record<string, string> = {},
  trialEnd?: number | null,
  billingCycleAnchor?: number | null,
) {
  const storedISO = metadata.first_dispatch_iso;
  const timestamp = trialEnd || billingCycleAnchor;
  const dispatchISO = storedISO && /^\d{4}-\d{2}-\d{2}$/.test(storedISO)
    ? storedISO : timestamp ? toISODate(new Date(timestamp * 1000)) : "";
  const weekday = ["Monday", "Thursday"].includes(metadata.dispatch_weekday)
    ? metadata.dispatch_weekday : dispatchISO ? weekdayFromISO(dispatchISO) : "your scheduled dispatch day";
  return { dispatchISO, weekday };
}
export function strainForDispatch(iso: string): string {
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const monday = addCalendarDays(iso, -((weekday + 6) % 7));
  const weeks = Math.round((Date.parse(`${monday}T12:00:00Z`) - Date.parse("2026-07-13T12:00:00Z")) / (7 * DAY_MS));
  return ["PRCXN", "SPCTRL", "LVLV"][((2 + weeks) % 3 + 3) % 3];
}
