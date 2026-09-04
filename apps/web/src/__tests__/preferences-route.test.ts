/**
 * Tests for GET/PATCH /api/v1/preferences (issue #11).
 *
 * Covers default preferences when nothing is saved, reading saved rows,
 * upsert semantics (create vs update), body validation, and rate limiting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  notificationPreference: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
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

import { GET, PATCH } from '@/app/api/v1/preferences/route';

function preferenceRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'default',
    channels: JSON.stringify(['websocket', 'email']),
    events: JSON.stringify(['PAYMENT', 'SOROBAN_INVOKE']),
    enabled: true,
    ...overrides,
  };
}

function getRequest(query = '') {
  return GET(new Request(`http://localhost:3000/api/v1/preferences${query}`), undefined);
}

function patchRequest(body: unknown, query = '') {
  return PATCH(
    new Request(`http://localhost:3000/api/v1/preferences${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ limited: false, headers: {}, response: null });
});

describe('GET /api/v1/preferences', () => {
  it('returns defaults when no preferences have been saved', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue(null);

    const res = await getRequest();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toEqual({
      userId: 'default',
      channels: ['websocket'],
      events: [],
      enabled: true,
    });
    expect(prismaMock.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'default' },
    });
  });

  it('parses and returns saved preferences with the requested userId', async () => {
    prismaMock.notificationPreference.findUnique.mockResolvedValue(preferenceRow());

    const res = await getRequest('?userId=demo-user');
    const body = await res.json();

    expect(prismaMock.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'demo-user' },
    });
    expect(body.data).toEqual({
      userId: 'default',
      channels: ['websocket', 'email'],
      events: ['PAYMENT', 'SOROBAN_INVOKE'],
      enabled: true,
    });
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockResolvedValue({
      limited: true,
      headers: {},
      response: new Response('Too Many Requests', { status: 429 }),
    });

    const res = await getRequest();
    expect(res.status).toBe(429);
  });
});

describe('PATCH /api/v1/preferences', () => {
  it('creates preferences on first save (upsert create path)', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue(
      preferenceRow({
        channels: JSON.stringify(['email']),
        events: JSON.stringify(['DEX_TRADE']),
      }),
    );

    const res = await patchRequest({ channels: ['email'], events: ['DEX_TRADE'] });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.channels).toEqual(['email']);
    expect(body.data.events).toEqual(['DEX_TRADE']);

    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'default' },
      update: {
        channels: JSON.stringify(['email']),
        events: JSON.stringify(['DEX_TRADE']),
      },
      create: expect.objectContaining({
        userId: 'default',
        channels: JSON.stringify(['email']),
        events: JSON.stringify(['DEX_TRADE']),
        enabled: true,
      }),
    });
  });

  it('updates only the provided fields on an existing row', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue(
      preferenceRow({ events: JSON.stringify(['PAYMENT', 'NFT_TRANSFER']) }),
    );

    const res = await patchRequest({ events: ['PAYMENT', 'NFT_TRANSFER'] });
    expect(res.status).toBe(200);

    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: 'default' },
      update: { events: JSON.stringify(['PAYMENT', 'NFT_TRANSFER']) },
      create: expect.objectContaining({
        userId: 'default',
        channels: JSON.stringify(['websocket']),
        events: JSON.stringify(['PAYMENT', 'NFT_TRANSFER']),
        enabled: true,
      }),
    });
  });

  it('toggles the master enabled flag', async () => {
    prismaMock.notificationPreference.upsert.mockResolvedValue(preferenceRow({ enabled: false }));

    const res = await patchRequest({ enabled: false });
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { enabled: false } }),
    );
  });

  it('rejects an empty body', async () => {
    const res = await patchRequest({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown channels and non-event types', async () => {
    const res = await patchRequest({ channels: ['sms'] });
    expect(res.status).toBe(400);

    const res2 = await patchRequest({ events: ['NOT_AN_EVENT'] });
    expect(res2.status).toBe(400);
  });

  it('rejects empty channel selections', async () => {
    const res = await patchRequest({ channels: [] });
    expect(res.status).toBe(400);
  });
});
