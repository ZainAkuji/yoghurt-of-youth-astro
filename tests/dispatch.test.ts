import test from "node:test";
import assert from "node:assert/strict";
import { nextDispatchISO, nextSubscriptionISO, subscriptionSchedule, subscriptionDispatchDetails, dispatchDelayed, strainForDispatch, toISODate } from "../lib/dispatch.js";

const boundaries = [
  ["2026-10-24T19:59:59Z", "2026-10-26", "Monday"], // BST, just before Sat 9pm
  ["2026-10-24T20:00:00Z", "2026-10-29", "Thursday"],
  ["2026-10-25T11:00:00Z", "2026-10-29", "Thursday"], // clocks back
  ["2026-10-27T20:59:59Z", "2026-10-29", "Thursday"], // GMT
  ["2026-10-27T21:00:00Z", "2026-11-02", "Monday"],
  ["2026-10-31T20:59:59Z", "2026-11-02", "Monday"],
  ["2026-10-31T21:00:00Z", "2026-11-05", "Thursday"],
  ["2027-06-08T19:59:59Z", "2027-06-10", "Thursday"], // BST
  ["2027-06-08T20:00:00Z", "2027-06-14", "Monday"],
  ["2026-12-22T21:00:00Z", "2027-01-04", "Monday"], // three blocked slots
  ["2027-05-01T12:00:00Z", "2027-05-06", "Thursday"], // holiday changes initial weekday
  ["2029-03-24T20:59:59Z", "2029-03-26", "Monday"], // spring DST weekend
];
for (const [instant, iso, day] of boundaries) {
  test(`${instant}: one-off, subscription and billing select ${day} ${iso}`, () => {
    const now = new Date(instant);
    assert.equal(nextDispatchISO(now), iso);
    assert.equal(nextSubscriptionISO(now), iso);
    const schedule = subscriptionSchedule(now);
    assert.equal(schedule.dispatchISO, iso);
    assert.equal(schedule.weekday, day);
    assert.ok(schedule.trialEnd - now.getTime() / 1000 >= 48 * 3600);
    assert.equal(toISODate(new Date(schedule.trialEnd * 1000)), iso);
    // Weekly Stripe billing keeps its weekday through both clock changes.
    for (const weeks of [1, 22, 28, 52]) {
      assert.equal(new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Europe/London" }).format(new Date((schedule.trialEnd + weeks * 7 * 86400) * 1000)), day);
    }
  });
}

test("holiday notice and weekly strain rotation follow the actual first dispatch", () => {
  assert.equal(dispatchDelayed("oneoff", new Date("2027-05-01T12:00:00Z")), true);
  assert.equal(dispatchDelayed("subscription", new Date("2026-10-26T12:00:00Z")), false);
  assert.equal(strainForDispatch("2026-07-13"), "LVLV");
  assert.equal(strainForDispatch("2026-07-16"), "LVLV");
  assert.equal(strainForDispatch("2026-07-20"), "PRCXN");
  assert.equal(strainForDispatch("2026-07-30"), "SPCTRL");
  assert.equal(strainForDispatch("2026-10-22"), strainForDispatch("2026-10-19"));
  assert.notEqual(strainForDispatch("2026-10-29"), strainForDispatch("2026-10-22"));
});

test("saved weekday takes priority; older subscriptions infer their real day", () => {
  assert.deepEqual(subscriptionDispatchDetails({ first_dispatch_iso: "2026-10-29", dispatch_weekday: "Thursday" }, Date.parse("2026-11-02T21:00:00Z") / 1000), { dispatchISO: "2026-10-29", weekday: "Thursday" });
  for (const [iso, day] of [["2026-10-29", "Thursday"], ["2026-11-02", "Monday"]]) {
    assert.equal(subscriptionDispatchDetails({}, Date.parse(`${iso}T21:00:00Z`) / 1000).weekday, day);
    assert.equal(subscriptionDispatchDetails({}, null, Date.parse(`${iso}T21:00:00Z`) / 1000).weekday, day);
  }
});
