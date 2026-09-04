import { prisma } from '@mizpah-pulse/database';
import { z } from 'zod';
import { errorResponse, successResponse, ErrorCode, createRequestId } from '@/lib/api-errors';
import { prismaErrorResponse } from '@/lib/prisma-errors';
import { rateLimit } from '@/lib/rate-limit';
import { requireApiKey } from '@/lib/api-key';
import { withRequestId } from '@/lib/request-id';
import { withCompression } from '@/lib/compress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Audit-log query schema (issue #34). Filters are optional exact-match
 * strings; pagination is page/limit, matching the webhooks list endpoint.
 */
const AuditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  resource: z.string().trim().min(1).max(100).optional(),
  userId: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/v1/audit-logs
 *
 * Read audit log entries (written by the database middleware extension),
 * newest first, filterable by action/resource/userId with pagination.
 */
async function GETHandler(request: Request) {
  const rateLimitResult = await rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    keyPrefix: 'audit-logs',
  });
  if (rateLimitResult.limited) return rateLimitResult.response!;

  const auth = await requireApiKey(request);
  if (auth.response) return auth.response;

  const requestId = request.headers.get('X-Request-ID') ?? createRequestId();

  try {
    const { searchParams } = new URL(request.url);
    const queryResult = AuditLogQuerySchema.safeParse({
      action: searchParams.get('action') ?? undefined,
      resource: searchParams.get('resource') ?? undefined,
      userId: searchParams.get('userId') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    if (!queryResult.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Invalid audit log query parameters',
        queryResult.error.flatten() as unknown as Record<string, unknown>,
        requestId,
      );
    }

    const { action, resource, userId, page, limit } = queryResult.data;
    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (userId) where.userId = userId;

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return successResponse(
      {
        data: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      200,
      undefined,
      { 'X-Request-ID': requestId, ...rateLimitResult.headers },
    );
  } catch (error) {
    return prismaErrorResponse(error, 'Failed to retrieve audit logs', requestId);
  }
}

export const GET = withCompression(withRequestId(GETHandler));
