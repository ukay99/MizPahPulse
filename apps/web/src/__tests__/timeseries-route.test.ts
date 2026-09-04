/**
 * Tests for GET /api/v1/stats/timeseries (issue #37).
 *
 * Covers param validation (granularity/range), zero-filled continuous buckets,
 * category keying, the in-memory TTL cache, rate limiting, and API-key auth.
 * `vi.resetModules()` resets the module-level cache between tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextResponse } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  event: {
    findMany: vi.fn(),
  },
}));

vi.mock('@mizpah-pulse/database', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: rateLimitMock,
}));

const requireApiKeyMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-key', () => ({
  requireApiKey: requireApiKeyMock,
}));

let GET: (req: Request, ctx?: unknown) => Promise<NextResponse>;

async function loadRoute() {
  vi.resetModules();
  const mod = await import('@/app/api/v1/stats/timeseries/route');
  GET = mod.GET;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await loadRoute();
  prismaMock.event.findMany.mockResolvedValue([]);
  rateLimitMock.mockResolvedValue({ limited: false, headers: {}, response: null });
  requireApiKeyMock.mockResolvedValue({ response: null });
  // Fixed "now" for deterministic bucket boundaries.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function timeseriesRequest(query = '') {
  return GET(new Request(`http://localhost:3000/api/v1/stats/timeseries${query}`));
}

describe('GET /api/v1/stats/timeseries', () => {
  it('returns 24 hourly zero-filled buckets for the default range', async () => {
    const res = await timeseriesRequest();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.granularity).toBe('hour');
    expect(body.data.range).toBe('24h');
    expect(body.data.buckets).toHaveLength(25); // includes the current (partial) hour
    expect(body.data.buckets[0].label).toMatch(/^\d{2}:00$/);
    expect(body.data.buckets.every((b: { total: number }) => b.total === 0)).toBe(true);
  });

  it('aggregates events into their bucket and keeps category keys stable', async () => {
    // Events at 08:00Z and 08:30Z on 2026-09-04 fall in the same hour bucket.
    prismaMock.event.findMany.mockResolvedValue([
      { timestamp: new Date('2026-09-04T08:00:00.000Z'), category: 'PAYMENT' },
      { timestamp: new Date('2026-09-04T08:30:00.000Z'), category: 'PAYMENT' },
      { timestamp: new Date('2026-09-04T08:45:00.000Z'), category: 'DEX' },
      { timestamp: new Date('2026-09-04T03:00:00.000Z'), category: 'CONTRACT' },
    ]);

    const res = await timeseriesRequest();
    const body = await res.json();
    const buckets = body.data.buckets;

    const hour8 = buckets.find((b: { label: string }) => b.label === '08:00');
    expect(hour8).toBeDefined();
    expect(hour8.counts).toEqual({ PAYMENT: 2, DEX: 1, CONTRACT: 0 });
    expect(hour8.total).toBe(3);

    const hour3 = buckets.find((b: { label: string }) => b.label === '03:00');
    expect(hour3.counts).toEqual({ PAYMENT: 0, DEX: 0, CONTRACT: 1 });
    expect(hour3.total).toBe(1);

    // Zero buckets still carry the same category keys.
    const hour0 = buckets.find((b: { label: string }) => b.label === '00:00');
    expect(hour0.counts).toEqual({ PAYMENT: 0, DEX: 0, CONTRACT: 0 });
    expect(body.data.totalEvents).toBe(4);
  });

  it('returns day buckets for range=7d with day labels', async () => {
    const res = await timeseriesRequest('?granularity=day&range=7d');
    const body = await res.json();

    expect(body.data.granularity).toBe('day');
    expect(body.data.range).toBe('7d');
    expect(body.data.buckets.length).toBeGreaterThanOrEqual(7);
    expect(body.data.buckets[0].label).toMatch(/[A-Z][a-z]{2} \d{1,2}/);
  });

  it('rejects invalid granularity and range values', async () => {
    const res = await timeseriesRequest('?granularity=minute');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    const res2 = await timeseriesRequest('?range=1y');
    expect(res2.status).toBe(400);
  });

  it('serves a cached response for the same granularity+range within TTL', async () => {
    await timeseriesRequest();
    const rows = [{ timestamp: new Date('2026-09-04T08:00:00.000Z'), category: 'PAYMENT' }];
    prismaMock.event.findMany.mockResolvedValue(rows);

    const res = await timeseriesRequest();
    const body = await res.json();
    expect(body.meta.cached).toBe(true);
    expect(res.headers.get('X-Cache')).toBe('HIT');
    // Data from the first (empty) call was cached, not the second.
    expect(body.data.totalEvents).toBe(0);
    expect(prismaMock.event.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValue({
      limited: true,
      headers: {},
      response: new Response('Too Many Requests', { status: 429 }),
    });

    const res = await timeseriesRequest();
    expect(res.status).toBe(429);
  });

  it('honors API-key enforcement responses', async () => {
    requireApiKeyMock.mockResolvedValue({
      response: new Response('Unauthorized', { status: 401 }),
    });

    const res = await timeseriesRequest();
    expect(res.status).toBe(401);
  });
});
