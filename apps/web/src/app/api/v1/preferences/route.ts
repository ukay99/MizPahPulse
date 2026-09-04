import { prisma } from '@mizpah-pulse/database';
import { EventType } from '@mizpah-pulse/types';
import { z } from 'zod';
import { errorResponse, successResponse, ErrorCode, createRequestId } from '@/lib/api-errors';
import { prismaErrorResponse } from '@/lib/prisma-errors';
import { rateLimit } from '@/lib/rate-limit';
import { withRequestId } from '@/lib/request-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Default preferences used when the user has not saved any yet. */
const DEFAULT_CHANNELS = ['websocket'];
const DEFAULT_EVENTS: string[] = [];

/**
 * Update schema (issue #11). Channels are delivery transports; events are the
 * event types the user wants notified about. Every field is optional so the
 * client can send only what changed.
 */
const UpdatePreferencesSchema = z
  .object({
    channels: z
      .array(z.enum(['websocket', 'email']))
      .min(1, 'Select at least one notification channel')
      .max(2)
      .optional(),
    events: z.array(EventType).max(50, 'Too many event types selected').optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one preference field must be provided',
    path: ['body'],
  });

function parseJsonList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Shape sent to the client for a saved preference row. */
function toPreferencePayload(pref: {
  userId: string;
  channels: unknown;
  events: unknown;
  enabled: boolean;
}) {
  return {
    userId: pref.userId,
    channels: parseJsonList(pref.channels),
    events: parseJsonList(pref.events),
    enabled: pref.enabled,
  };
}

/**
 * GET /api/v1/preferences
 *
 * Read notification preferences for the (demo) user. When none have been
 * saved yet, returns the defaults so the settings page always has a shape
 * to render.
 */
async function GETHandler(request: Request) {
  const rateLimitResult = await rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    keyPrefix: 'preferences:read',
  });
  if (rateLimitResult.limited) return rateLimitResult.response!;

  const requestId = request.headers.get('X-Request-ID') ?? createRequestId();

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default';

    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (!prefs) {
      return successResponse(
        {
          userId,
          channels: DEFAULT_CHANNELS,
          events: DEFAULT_EVENTS,
          enabled: true,
        },
        200,
        undefined,
        { 'X-Request-ID': requestId, ...rateLimitResult.headers },
      );
    }

    return successResponse(toPreferencePayload(prefs), 200, undefined, {
      'X-Request-ID': requestId,
      ...rateLimitResult.headers,
    });
  } catch (error) {
    return prismaErrorResponse(error, 'Failed to read notification preferences', requestId);
  }
}

/**
 * PATCH /api/v1/preferences
 *
 * Create or update notification preferences (upsert on the unique userId).
 */
async function PATCHHandler(request: Request) {
  const rateLimitResult = await rateLimit(request, {
    maxRequests: 20,
    windowMs: 60_000,
    keyPrefix: 'preferences:update',
  });
  if (rateLimitResult.limited) return rateLimitResult.response!;

  const requestId = request.headers.get('X-Request-ID') ?? createRequestId();

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default';

    const body: unknown = await request.json().catch(() => {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['body'],
          message: 'Request body must be valid JSON',
        },
      ]);
    });

    const parsed = UpdatePreferencesSchema.parse(body);
    const data: Record<string, unknown> = {};
    if (parsed.channels !== undefined) data.channels = JSON.stringify(parsed.channels);
    if (parsed.events !== undefined) data.events = JSON.stringify(parsed.events);
    if (parsed.enabled !== undefined) data.enabled = parsed.enabled;

    const saved = await prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        channels: JSON.stringify(parsed.channels ?? DEFAULT_CHANNELS),
        events: JSON.stringify(parsed.events ?? DEFAULT_EVENTS),
        enabled: parsed.enabled ?? true,
      },
    });

    return successResponse(toPreferencePayload(saved), 200, undefined, {
      'X-Request-ID': requestId,
      ...rateLimitResult.headers,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Invalid notification preferences',
        error.flatten() as unknown as Record<string, unknown>,
        requestId,
      );
    }
    return prismaErrorResponse(error, 'Failed to save notification preferences', requestId);
  }
}

export const GET = withRequestId(GETHandler);
export const PATCH = withRequestId(PATCHHandler);
