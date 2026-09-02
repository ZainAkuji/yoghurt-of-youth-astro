// ============================================================
// DISPATCH CONFIGURATION
// Change SUBSCRIPTION_DAY here and it applies across the site.
// The Stripe endpoint has its own copy — see api/stripe/create-subscription-session.ts
// ============================================================

// 0 = Sunday, 1 = Monday ... 6 = Saturday
export const SUBSCRIPTION_DAY = 4; // Thursday

export const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

export const SUBSCRIPTION_DAY_NAME = DAY_NAMES[SUBSCRIPTION_DAY];

// One-off dispatch days, in the same 0–6 notation.
export const DISPATCH_DAYS = [1, 4]; // Monday and Thursday

// TEMPORARY — set to null before deploying
const FAKE_NOW: string | null = null;

function clock(): Date {
  return FAKE_NOW ? new Date(FAKE_NOW) : new Date();
}

export function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDateUK(iso: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function weekdayFromISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

// ============================================================
// BLOCKED DISPATCH DATES
// Dates we cannot dispatch on — bank holidays and the days
// immediately affected by courier backlog around them.
//
// The logic steps forward to the next dispatch day that isn't
// blocked, repeating until it finds a clear one. So Thu 24 Dec
// 2026 → Mon 28 (blocked) → Thu 31 (blocked) → Mon 4 Jan.
//
// REFRESH ANNUALLY. Check gov.uk/bank-holidays.json each December
// and extend the list, or dispatch dates will silently stop
// skipping holidays.
// ============================================================
export const BLOCKED_DISPATCH = new Set([
  // Christmas / New Year 2026
  "2026-12-24", // Thu
  "2026-12-28", // Mon
  "2026-12-31", // Thu
  // Easter 2027
  "2027-03-25", // Thu before Good Friday
  "2027-03-29", // Easter Monday
  // Bank holiday Mondays 2027
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  // Christmas / New Year 2027–28
  "2027-12-27", // Mon
  "2028-01-03", // Mon
  // Easter 2028
  "2028-04-13", // Thu before Good Friday
  "2028-04-17", // Easter Monday
  // Bank holiday Mondays 2028
  "2028-05-01",
  "2028-05-29",
  "2028-08-28",
  // Christmas / New Year 2028–29
  "2028-12-25", // Mon
  "2029-01-01", // Mon
]);

// True if we have run past the end of the blocked-date list.
export function holidayListNeedsRefresh(): boolean {
  const last = [...BLOCKED_DISPATCH].sort().pop() || "";
  return toISODate(clock()) > last;
}

// Next one-off dispatch day, skipping blocked dates.
// Requires at least 2 clear days' notice — we ferment the day before dispatch.
export function nextDispatchISO(): string {
  const d = clock();
  d.setHours(0, 0, 0, 0);

  let guard = 0;
  let elapsed = 0;
  while (guard++ < 60) {
    d.setDate(d.getDate() + 1);
    elapsed++;
    if (elapsed < 2) continue;
    if (!DISPATCH_DAYS.includes(d.getDay())) continue;
    const iso = toISODate(d);
    if (!BLOCKED_DISPATCH.has(iso)) return iso;
  }
  return toISODate(d); // fallback, should never be reached
}

// Next eligible subscription dispatch day, skipping blocked dates.
// Cutoff is two days before at 21:00 (Stripe needs trial_end 48h ahead).
export function nextSubscriptionISO(): string {
  const now = clock();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);

  let guard = 0;
  while (guard++ < 60) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== SUBSCRIPTION_DAY) continue;

    const cutoff = new Date(d);
    cutoff.setDate(d.getDate() - 2);
    cutoff.setHours(21, 0, 0, 0);
    if (now.getTime() >= cutoff.getTime()) continue; // too soon, try next week

    const iso = toISODate(d);
    if (!BLOCKED_DISPATCH.has(iso)) return iso;
  }
  return toISODate(d);
}

// Same walk as nextDispatchISO but ignoring blocked dates.
function nextDispatchUnblockedISO(): string {
  const d = clock();
  d.setHours(0, 0, 0, 0);
  let guard = 0;
  let elapsed = 0;
  while (guard++ < 60) {
    d.setDate(d.getDate() + 1);
    elapsed++;
    if (elapsed < 2) continue;
    if (DISPATCH_DAYS.includes(d.getDay())) return toISODate(d);
  }
  return toISODate(d);
}

function nextSubscriptionUnblockedISO(): string {
  const now = clock();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  let guard = 0;
  while (guard++ < 60) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== SUBSCRIPTION_DAY) continue;
    const cutoff = new Date(d);
    cutoff.setDate(d.getDate() - 2);
    cutoff.setHours(21, 0, 0, 0);
    if (now.getTime() >= cutoff.getTime()) continue;
    return toISODate(d);
  }
  return toISODate(d);
}

export function dispatchDelayed(mode: "oneoff" | "subscription"): boolean {
  return mode === "subscription"
    ? nextSubscriptionISO() !== nextSubscriptionUnblockedISO()
    : nextDispatchISO() !== nextDispatchUnblockedISO();
}