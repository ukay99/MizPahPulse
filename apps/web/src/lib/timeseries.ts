/**
 * Time-series aggregation helpers (issue #37), extracted from the route so
 * the bucketing math is unit-testable and Next.js route files only export
 * handlers.
 */

export type Granularity = 'hour' | 'day';
export type TimeseriesRange = '24h' | '7d' | '30d';

export const GRANULARITY_MS: Record<Granularity, number> = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

export const RANGE_MS: Record<TimeseriesRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Floor a timestamp to the bucket boundary (UTC-aligned so buckets line up at :00). */
export function floorToBucket(ts: number, granularity: Granularity): number {
  return Math.floor(ts / GRANULARITY_MS[granularity]) * GRANULARITY_MS[granularity];
}

function hourLabel(bucketStart: number): string {
  const hours = new Date(bucketStart).getUTCHours();
  return `${String(hours).padStart(2, '0')}:00`;
}

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export interface TimeseriesBucket {
  start: string;
  label: string;
  counts: Record<string, number>;
  total: number;
}

export interface TimeseriesResult {
  granularity: Granularity;
  range: TimeseriesRange;
  start: string;
  end: string;
  totalEvents: number;
  buckets: TimeseriesBucket[];
}

/**
 * Aggregate raw `(timestamp, category)` rows into a continuous, zero-filled
 * series of buckets.
 */
export function buildTimeseriesBuckets(
  rows: Array<{ timestamp: Date; category: string }>,
  granularity: Granularity,
  range: TimeseriesRange,
  nowMs: number,
): TimeseriesResult {
  const rangeMs = RANGE_MS[range];
  const startMs = floorToBucket(nowMs - rangeMs, granularity);
  const endMs = nowMs;
  const stepMs = GRANULARITY_MS[granularity];

  const perBucket = new Map<number, Map<string, number>>();
  const categories = new Set<string>();
  let totalEvents = 0;

  for (const row of rows) {
    const ts = new Date(row.timestamp).getTime();
    if (ts < startMs || ts > endMs) continue;
    const bucketKey = floorToBucket(ts, granularity);
    const bucket = perBucket.get(bucketKey) ?? new Map<string, number>();
    const count = (bucket.get(row.category) ?? 0) + 1;
    bucket.set(row.category, count);
    perBucket.set(bucketKey, bucket);
    categories.add(row.category);
    totalEvents++;
  }

  const buckets: TimeseriesBucket[] = [];
  for (let t = startMs; t <= endMs; t += stepMs) {
    const bucketCounts = perBucket.get(t) ?? new Map<string, number>();
    const counts: Record<string, number> = {};
    let total = 0;
    // Zero-fill every category seen anywhere in the window so charts have a
    // stable set of keys across buckets.
    for (const category of categories) {
      const count = bucketCounts.get(category) ?? 0;
      counts[category] = count;
      total += count;
    }
    buckets.push({
      start: new Date(t).toISOString(),
      label: granularity === 'hour' ? hourLabel(t) : dayLabelFormatter.format(t),
      counts,
      total,
    });
  }

  return {
    granularity,
    range,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    totalEvents,
    buckets,
  };
}
