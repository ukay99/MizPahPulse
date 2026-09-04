import { prisma } from '@mizpah-pulse/database';
import { z } from 'zod';
import { errorResponse, successResponse, ErrorCode, createRequestId } from '@/lib/api-errors';
import { prismaErrorResponse } from '@/lib/prisma-errors';
import { rateLimit } from '@/lib/rate-limit';
import { withRequestId } from '@/lib/request-id';
import { withCompression } from '@/lib/compress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Delivery listing query schema (issue #17). Status filter is optional and
 * matches one of the worker's status values (PENDING/RETRYING/SUCCESS/FAILED).
 */
const DeliveriesQuerySchema = z.object({
  status: z.enum(['PENDING', 'RETRYING', 'SUCCESS', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * GET /api/v1/webhooks/[id]/deliveries
 *
 * List delivery attempts for a webhook subscription, newest first, with
 * page/limit pagination. Each delivery includes status, HTTP status code,
 * attempt count, error message, and timestamps for the delivery log viewer.
 */
async function GETHandler(request: Request, props: { params: Promise<{ id: string }> }) {
  const rateLimitResult = await rateLimit(request, {
    maxRequests: 60,
    windowMs: 60_000,
    keyPrefix: 'webhooks:deliveries',
  });
  if (rateLimitResult.limited) return rateLimitResult.response!;

  const requestId = request.headers.get('X-Request-ID') ?? createRequestId();

  try {
    const { id } = await props.params;
    if (!id) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Webhook id is required',
        undefined,
        requestId,
      );
    }

    const { searchParams } = new URL(request.url);
    const queryResult = DeliveriesQuerySchema.safeParse({
      status: searchParams.get('status') ?? undefined,
      page: searchParams.get('page') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
    });

    if (!queryResult.success) {
      return errorResponse(
        ErrorCode.VALIDATION_ERROR,
        'Invalid delivery query parameters',
        queryResult.error.flatten() as unknown as Record<string, unknown>,
        requestId,
      );
    }

    const webhook = await prisma.webhookSubscription.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!webhook) {
      return errorResponse(ErrorCode.NOT_FOUND, 'Webhook not found', undefined, requestId);
    }

    const { status, page, limit } = queryResult.data;
    const where: Record<string, unknown> = { subscriptionId: id };
    if (status) where.status = status;

    const skip = (page - 1) * limit;
    const [deliveries, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    return successResponse(
      {
        data: deliveries,
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
    return prismaErrorResponse(error, 'Failed to retrieve webhook deliveries', requestId);
  }
}

export const GET = withCompression(withRequestId(GETHandler));
