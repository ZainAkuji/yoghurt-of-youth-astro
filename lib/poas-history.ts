import type { Redis } from "@upstash/redis";

// First FULL UK day after deploying profit tracking.
export const POAS_START_DATE = "2026-09-29";

// Daily marketing cost in pence.
// Keep old entries and add future changes in date order.
const MARKETING_COSTS = [
  { from: "2026-09-28", pence: 1200 },
  // { from: "2026-10-05", pence: 1500 },
];

export function marketingSpend(day: string): number {
  const entry = [...MARKETING_COSTS]
    .reverse()
    .find(item => item.from <= day);

  if (!entry) {
    throw new Error(`Missing marketing cost for ${day}`);
  }

  return entry.pence;
}

export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export type ProfitDay = {
  day: string;
  profit: number;
  unknown: number;
};

export function periodPoas(days: ProfitDay[]): string {
  if (!days.length) {
    return "Waiting for a completed tracking day";
  }

  if (days.some(day => day.unknown > 0)) {
    return "Unavailable: missing order costs";
  }

  const spend = days.reduce(
    (sum, day) => sum + marketingSpend(day.day),
    0
  );

  const profit = days.reduce(
    (sum, day) => sum + day.profit,
    0
  );

  return spend === 0
    ? "N/A: no marketing spend"
    : `${(profit / spend).toFixed(2)}×`;
}

export async function poasHistoryHtml(
  redis: Redis,
  live: boolean,
  today: string
) {
  const dates: string[] = [];

  for (
    let day = POAS_START_DATE;
    day < today;
    day = shiftDay(day, 1)
  ) {
    dates.push(day);
  }

  const days: ProfitDay[] = [];

  // Missing days count as zero sales, with marketing cost included.
  for (let offset = 0; offset < dates.length; offset += 100) {
    const batch = dates.slice(offset, offset + 100);
    const pipeline = redis.pipeline();

    for (const day of batch) {
      const key =
        `yoy:oneoff-profit:v1:${live ? "live" : "test"}:${day}`;

      pipeline.hget(key, "profit");
      pipeline.hget(key, "unknown");
    }

    const values = await pipeline.exec();

    batch.forEach((day, index) => {
      const profit = Number(values[index * 2] ?? 0);
      const unknown = Number(values[index * 2 + 1] ?? 0);

      if (
        !Number.isSafeInteger(profit) ||
        !Number.isSafeInteger(unknown) ||
        unknown < 0
      ) {
        throw new Error(`Invalid stored profit for ${day}`);
      }

      days.push({ day, profit, unknown });
    });
  }

  const recent = days.filter(
    day => day.day >= shiftDay(today, -7)
  );

  const row = (label: string, value: string) =>
    `<tr>
      <td style="padding:6px 0">${label}</td>
      <td><strong>${value}</strong></td>
    </tr>`;

  return `
    <h4>Running POAS since 29th September 2026</h4>

    <table role="presentation" style="width:100%">
      <tbody>
        ${row(
          recent.length < 7
            ? `Recent POAS (${recent.length} completed days)`
            : "Last 7 completed days",
          periodPoas(recent)
        )}

        ${row(
          `Overall through ${shiftDay(today, -1)}`,
          periodPoas(days)
        )}
      </tbody>
    </table>

    <p style="font-size:12px;color:#555">
      Total estimated one-off profit before marketing divided by
      total marketing cost.
    </p>
  `;
}