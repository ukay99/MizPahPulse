import { prisma } from '@mizpah-pulse/database';
import { z } from 'zod';
import { errorResponse, successResponse, ErrorCode, createRequestId } from '@/lib/api-errors';
import { logger } from '@/lib/logger';
import { recordRequest } from '@/lib/monitoring';
import { rateLimit } from '@/lib/rate-limit';
import { requireApiKey } from '@/lib/api-key';
import { withRequestId } from '@/lib/request-id';
import {
  buildTimeseriesBuckets,
  RANGE_MS,
  type Granularity,
  type TimeseriesRange,
} from '@/lib/timeseries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Time-series query schema (issue #37). `granularity` and `range` are strict
 * enums so unsupported values fail with a 400 instead of being coerced.
 */
const TimeseriesQuerySchema = z.object({
  granularity: z.enum(['hour', 'day']).default('hour'),
  range: z.enum(['24h', '7d', '30d']).default('24h'),
});

// Simple in-memory cache (mirrors the /stats route).
let cachedTimeseries: { key: string; data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * GET /api/v1/stats/timeseries
 *
 * Event counts bucketed by hour or day over a 24h/7d/30d window, cached
 * briefly in memory (issue #37).
 */
async function GETHandler(request: Request) {
  const rateLimitResult = await rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    keyPrefix: 'stats:timeseries',
  });
  if (rateLimitResult.limited) return rateLimitResult.response!;

  const auth = await requireApiKey(request);
  if (auth.response) return auth.response;

  const requestId = request.headers.get('X-Request-ID') ?? createRequestId();

  try {
    const { searchParams } = new URL(request.url);
    const queryResult = TimeseriesQuerySchema.safeParse({
      granularity: searchParams.get('granularity') ?? undefined,
      range: searchParams.get('range') ?? undefined,
    });

    if (!queryResult.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Invalid granularity or range. Use granularity=hour|day and range=24h|7d|30d.',
        queryResult.error.flatten() as unknown as Record<string, unknown>,
        requestId,
      );
    }

    const { granularity, range } = queryResult.data;
    const cacheKey = `${granularity}:${range}`;
    const now = Date.now();
    if (
      cachedTimeseries &&
      cachedTimeseries.key === cacheKey &&
      now - cachedTimeseries.timestamp < CACHE_TTL
    ) {
      return successResponse(
        cachedTimeseries.data,
        200,
        { cached: true },
        { 'X-Request-ID': requestId, 'X-Cache': 'HIT', ...rateLimitResult.headers },
      );
    }

    const startDate = new Date(now - RANGE_MS[range as TimeseriesRange]);
    const rows = await prisma.event.findMany({
      where: { timestamp: { gte: startDate } },
      select: { timestamp: true, category: true },
      orderBy: { timestamp: 'asc' },
    });

    const data = buildTimeseriesBuckets(
      rows as Array<{ timestamp: Date; category: string }>,
      granularity as Granularity,
      range as TimeseriesRange,
      now,
    );

    cachedTimeseries = { key: cacheKey, data, timestamp: now };

    return successResponse(
      data,
      200,
      { cached: false },
      { 'X-Request-ID': requestId, ...rateLimitResult.headers },
    );
  } catch (error) {
    logger.error(`[API] Timeseries error (requestId=${requestId}):`, error);
    recordRequest(0, true);
    return errorResponse(
      ErrorCode.INTERNAL_ERROR,
      'Failed to fetch time-series data',
      undefined,
      requestId,
    );
  }
}

export const GET = withRequestId(GETHandler);
