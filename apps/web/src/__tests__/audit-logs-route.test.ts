/**
 * Tests for GET /api/v1/audit-logs (issue #34).
 *
 * Covers newest-first ordering, action/resource/userId filters, pagination
 * shape, validation of bad query params, rate limiting, and API-key auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  auditLog: {
    findMany: vi.fn(),
    count: vi.fn(),
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

import { GET } from '@/app/api/v1/audit-logs/route';

function auditLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    userId: 'demo-user',
    action: 'API_REQUEST',
    resource: 'event',
    resourceId: 'evt-1',
    details: { path: '/api/v1/events' },
    ipAddress: '127.0.0.1',
    userAgent: 'curl/8.0',
    createdAt: new Date('2026-09-04T10:00:00.000Z'),
    ...overrides,
  };
}

function logsRequest(query = '') {
  return GET(new Request(`http://localhost:3000/api/v1/audit-logs${query}`), undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.findMany.mockResolvedValue([auditLog()]);
  prismaMock.auditLog.count.mockResolvedValue(1);
  rateLimitMock.mockResolvedValue({ limited: false, headers: {}, response: null });
  requireApiKeyMock.mockResolvedValue({ response: null });
});

describe('GET /api/v1/audit-logs', () => {
  it('returns logs newest-first with pagination metadata', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([auditLog(), auditLog({ id: 'log-2' })]);
    prismaMock.auditLog.count.mockResolvedValue(2);

    const res = await logsRequest();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.data).toHaveLength(2);
    expect(body.data.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });

    // Newest first, no filter.
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      }),
    );
  });

  it('applies action/resource/userId filters when provided', async () => {
    await logsRequest('?action=DB_CREATE&resource=WebhookSubscription&userId=u-42');

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { action: 'DB_CREATE', resource: 'WebhookSubscription', userId: 'u-42' },
      }),
    );
    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({
      where: { action: 'DB_CREATE', resource: 'WebhookSubscription', userId: 'u-42' },
    });
  });

  it('paginates with page/limit and computes totalPages', async () => {
    prismaMock.auditLog.count.mockResolvedValue(45);

    const res = await logsRequest('?page=3&limit=10');
    const body = await res.json();

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
    expect(body.data.pagination).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
  });

  it('rejects out-of-range page/limit values with a 400', async () => {
    const res = await logsRequest('?limit=500');
    expect(res.status).toBe(400);

    const res2 = await logsRequest('?page=0');
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');

    const res3 = await logsRequest('?action=');
    expect(res3.status).toBe(400);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValue({
      limited: true,
      headers: {},
      response: new Response('Too Many Requests', { status: 429 }),
    });

    const res = await logsRequest();
    expect(res.status).toBe(429);
  });

  it('honors API-key enforcement responses', async () => {
    requireApiKeyMock.mockResolvedValue({
      response: new Response('Unauthorized', { status: 401 }),
    });

    const res = await logsRequest();
    expect(res.status).toBe(401);
  });

  it('maps database errors to the standard error envelope', async () => {
    prismaMock.auditLog.findMany.mockRejectedValue(new Error('db down'));

    const res = await logsRequest();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
