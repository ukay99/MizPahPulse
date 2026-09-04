/**
 * Tests for GET /api/v1/webhooks/[id]/deliveries (issue #17).
 *
 * Covers the delivery log shape (status/statusCode/attempt/error/timestamps),
 * newest-first ordering, status filtering, 404 for unknown webhooks, and
 * validation/rate-limit behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  webhookSubscription: { findUnique: vi.fn() },
  webhookDelivery: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('@mizpah-pulse/database', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: rateLimitMock,
}));

import { GET } from '@/app/api/v1/webhooks/[id]/deliveries/route';

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'del-1',
    subscriptionId: 'wh-1',
    eventId: 'evt-1',
    status: 'SUCCESS',
    statusCode: 200,
    attempt: 1,
    payload: { type: 'PAYMENT' },
    response: '{"ok":true}',
    error: null,
    createdAt: new Date('2026-09-04T10:00:00.000Z'),
    updatedAt: new Date('2026-09-04T10:00:00.000Z'),
    completedAt: new Date('2026-09-04T10:00:00.000Z'),
    ...overrides,
  };
}

function deliveriesRequest(id = 'wh-1', query = '') {
  return GET(new Request(`http://localhost:3000/api/v1/webhooks/${id}/deliveries${query}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.webhookSubscription.findUnique.mockResolvedValue({ id: 'wh-1' });
  prismaMock.webhookDelivery.findMany.mockResolvedValue([delivery()]);
  prismaMock.webhookDelivery.count.mockResolvedValue(1);
  rateLimitMock.mockResolvedValue({ limited: false, headers: {}, response: null });
});

describe('GET /api/v1/webhooks/[id]/deliveries', () => {
  it('returns deliveries newest-first with pagination metadata', async () => {
    prismaMock.webhookDelivery.findMany.mockResolvedValue([
      delivery(),
      delivery({ id: 'del-2', status: 'FAILED', error: 'timeout' }),
    ]);
    prismaMock.webhookDelivery.count.mockResolvedValue(2);

    const res = await deliveriesRequest();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.data).toHaveLength(2);
    expect(body.data.data[0]).toEqual(
      expect.objectContaining({
        id: 'del-1',
        status: 'SUCCESS',
        statusCode: 200,
        attempt: 1,
        error: null,
        completedAt: '2026-09-04T10:00:00.000Z',
      }),
    );
    expect(body.data.pagination).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });

    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: 'wh-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      }),
    );
  });

  it('filters by delivery status when requested', async () => {
    await deliveriesRequest('wh-1', '?status=FAILED');

    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: 'wh-1', status: 'FAILED' },
      }),
    );
  });

  it('paginates with page/limit', async () => {
    prismaMock.webhookDelivery.count.mockResolvedValue(23);
    const res = await deliveriesRequest('wh-1', '?page=3&limit=5');
    const body = await res.json();

    expect(prismaMock.webhookDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
    expect(body.data.pagination).toEqual({ page: 3, limit: 5, total: 23, totalPages: 5 });
  });

  it('returns 404 when the webhook does not exist', async () => {
    prismaMock.webhookSubscription.findUnique.mockResolvedValue(null);

    const res = await deliveriesRequest('missing');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(prismaMock.webhookDelivery.findMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid status filter', async () => {
    const res = await deliveriesRequest('wh-1', '?status=queued');
    expect(res.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValue({
      limited: true,
      headers: {},
      response: new Response('Too Many Requests', { status: 429 }),
    });

    const res = await deliveriesRequest();
    expect(res.status).toBe(429);
  });
});
