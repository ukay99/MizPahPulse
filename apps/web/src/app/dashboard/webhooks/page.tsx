'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Badge, cn, StatusDot, EmptyState, Skeleton } from '@mizpah-pulse/ui';
import { Webhook, Plus, Copy, Trash2, X, ChevronDown, ChevronRight, Inbox } from 'lucide-react';
import { isValidUrl } from '@/lib/validators';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { formatTimeAgo } from '@/lib/date-utils';
import { truncateHash } from '@/lib/display-utils';

const EVENT_OPTIONS = [
  'PAYMENT',
  'DEX_TRADE',
  'SOROBAN_INVOKE',
  'SOROBAN_EVENT',
  'NFT_TRANSFER',
  'TOKEN_TRANSFER',
];

interface WebhookItem {
  id: string;
  endpoint: string;
  events: string[];
  status: 'active' | 'error';
  deliveries: number;
  lastDelivery: string | null;
  failedDeliveries: number;
}

interface ApiWebhook {
  id: string;
  endpoint: string;
  events: string[];
  isActive: boolean;
  failedDeliveries: number;
  lastDeliveryAt?: string | null;
  createdAt: string;
  deliveries?: Array<{ id: string; createdAt: string }>;
}

interface DeliveryItem {
  id: string;
  eventId: string;
  status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED';
  statusCode?: number | null;
  attempt: number;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

interface DeliveryPage {
  data: DeliveryItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** Map a delivery status to the Badge variant used in the log viewer. */
function deliveryBadgeVariant(
  status: DeliveryItem['status'],
): 'success' | 'warning' | 'error' | 'default' {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'RETRYING':
    case 'PENDING':
      return 'warning';
    case 'FAILED':
      return 'error';
    default:
      return 'default';
  }
}

function mapWebhook(w: ApiWebhook): WebhookItem {
  const lastAt = w.lastDeliveryAt ? new Date(w.lastDeliveryAt).getTime() : null;
  return {
    id: w.id,
    endpoint: w.endpoint,
    events: Array.isArray(w.events) ? w.events : [],
    status: w.isActive ? 'active' : 'error',
    deliveries: w.deliveries?.length ?? 0,
    lastDelivery: lastAt ? formatTimeAgo(new Date(lastAt)) : '—',
    failedDeliveries: w.failedDeliveries ?? 0,
  };
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['PAYMENT']);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Delivery-log viewer state (issue #17): one expansion at a time; the map
  // caches already-fetched delivery pages per webhook so re-expanding is free.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveriesByWebhook, setDeliveriesByWebhook] = useState<Record<string, DeliveryItem[]>>(
    {},
  );
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const loadDeliveries = useCallback(
    async (webhookId: string) => {
      if (deliveriesByWebhook[webhookId]) return; // already cached
      setDeliveryLoading(true);
      setDeliveryError(null);
      try {
        const page = await apiFetch<DeliveryPage>(
          `/api/v1/webhooks/${webhookId}/deliveries?limit=10`,
        );
        setDeliveriesByWebhook((prev) => ({ ...prev, [webhookId]: page.data ?? [] }));
      } catch (err) {
        setDeliveryError(err instanceof Error ? err.message : 'Failed to load delivery logs');
      } finally {
        setDeliveryLoading(false);
      }
    },
    [deliveriesByWebhook],
  );

  const toggleExpanded = (id: string) => {
    const next = expandedId === id ? null : id;
    setExpandedId(next);
    if (next) void loadDeliveries(next);
  };

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const data = await apiFetch<ApiWebhook[]>('/api/v1/webhooks');
      setWebhooks(data.map(mapWebhook));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await apiFetch<ApiWebhook[]>('/api/v1/webhooks', {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setWebhooks(data.map(mapWebhook));
      } catch (err) {
        if (!controller.signal.aborted) {
          setPageError(err instanceof Error ? err.message : 'Failed to load webhooks');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const handleCreate = async () => {
    // Validate the endpoint URL before submitting
    if (!isValidUrl(endpoint)) {
      setEndpointError('Enter a valid https:// webhook endpoint URL');
      return;
    }
    if (selectedEvents.length === 0) {
      setEndpointError('Select at least one event type');
      return;
    }

    setCreating(true);
    setEndpointError(null);
    try {
      const created = await apiFetch<ApiWebhook>('/api/v1/webhooks', {
        method: 'POST',
        body: { endpoint, events: selectedEvents },
      });
      setWebhooks((prev) => [mapWebhook(created), ...prev]);
      setEndpoint('');
      setIsCreating(false);
    } catch (err) {
      setEndpointError(
        err instanceof ApiClientError ? err.message : 'Failed to create webhook. Try again.',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setPageError('Failed to delete webhook. Try again.');
    }
  };

  const handleCopy = async (endpointUrl: string) => {
    try {
      await navigator.clipboard.writeText(endpointUrl);
      setCopyStatus(endpointUrl);
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus(null);
    }
  };

  const toggleEvent = (evt: string) => {
    setSelectedEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt],
    );
  };

  const activeCount = webhooks.filter((w) => w.status === 'active').length;
  const totalDelivered = webhooks.reduce((s, w) => s + w.deliveries, 0);
  const configuredEvents = webhooks.reduce((s, w) => s + w.events.length, 0);

  /** Latest deliveries for the expanded webhook, or null while never loaded. */
  const expandedDeliveries = expandedId ? (deliveriesByWebhook[expandedId] ?? null) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Webhooks</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure webhook endpoints for real-time event delivery
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreating(true);
            setEndpointError(null);
          }}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-500/25"
        >
          <Plus className="h-4 w-4" />
          New Webhook
        </button>
      </div>

      {pageError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <span>{pageError}</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadWebhooks()}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
            <button
              onClick={() => setPageError(null)}
              className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-900"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create webhook form */}
      {isCreating && (
        <Card padding="lg" className="border-indigo-200 dark:border-indigo-800">
          <div className="flex items-start justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Create Webhook Endpoint
            </h2>
            <button
              onClick={() => setIsCreating(false)}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label="Close create form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="webhook-endpoint"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Endpoint URL
              </label>
              <input
                id="webhook-endpoint"
                type="url"
                value={endpoint}
                onChange={(e) => {
                  setEndpoint(e.target.value);
                  if (endpointError) setEndpointError(null);
                }}
                placeholder="https://your-app.com/webhooks/stellar"
                className={cn(
                  'mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors dark:bg-slate-950 dark:text-slate-100',
                  endpointError
                    ? 'border-red-400 focus:border-red-500 dark:border-red-800'
                    : 'border-slate-200 focus:border-indigo-500 dark:border-slate-700',
                )}
                aria-invalid={!!endpointError}
                aria-describedby={endpointError ? 'webhook-endpoint-error' : undefined}
              />
              {endpointError && (
                <p id="webhook-endpoint-error" className="mt-1 text-xs text-red-500" role="alert">
                  {endpointError}
                </p>
              )}
            </div>

            <div>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Event types
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {EVENT_OPTIONS.map((evt) => {
                  const selected = selectedEvents.includes(evt);
                  return (
                    <button
                      key={evt}
                      onClick={() => toggleEvent(evt)}
                      aria-pressed={selected}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        selected
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                          : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400',
                      )}
                    >
                      {evt}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create Webhook'}
            </button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active Webhooks', value: activeCount },
          { label: 'Total Delivered', value: totalDelivered.toLocaleString() },
          { label: 'Configured Events', value: configuredEvents },
        ].map((stat) => (
          <Card key={stat.label} padding="md">
            <div className="text-center">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
              <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {loading ? <Skeleton className="mx-auto h-8 w-16" /> : stat.value}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} padding="md">
              <div className="flex items-center gap-4">
                <Skeleton variant="circular" className="h-10 w-10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Webhook className="h-10 w-10" />}
            title="No webhooks configured"
            description="Create your first webhook endpoint to start receiving blockchain events"
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <Card key={wh.id} padding="md">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-50 dark:bg-purple-950">
                  <Webhook className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm text-slate-900 dark:text-slate-100">
                      {wh.endpoint}
                    </span>
                    <StatusDot status={wh.status === 'active' ? 'online' : 'error'} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {wh.events.map((e) => (
                      <Badge key={e} variant="default" size="sm">
                        {e}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {wh.deliveries} deliveries · Last: {wh.lastDelivery}
                    {wh.failedDeliveries > 0 && (
                      <span className="text-red-500"> · {wh.failedDeliveries} failed</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleExpanded(wh.id)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800"
                    aria-expanded={expandedId === wh.id}
                    aria-controls={`deliveries-${wh.id}`}
                  >
                    {expandedId === wh.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Delivery log
                  </button>
                  <button
                    onClick={() => handleCopy(wh.endpoint)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-800"
                    aria-label={`Copy endpoint URL${copyStatus === wh.endpoint ? ' (copied)' : ''}`}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => void handleDelete(wh.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-800"
                    aria-label={`Delete webhook ${wh.endpoint}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Expandable delivery log viewer (issue #17) */}
              {expandedId === wh.id && (
                <div
                  id={`deliveries-${wh.id}`}
                  className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Inbox className="h-4 w-4 text-slate-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Recent deliveries
                    </h3>
                  </div>

                  {deliveryError && (
                    <p role="alert" className="text-sm text-red-500">
                      {deliveryError}
                    </p>
                  )}

                  {deliveryLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : expandedDeliveries && expandedDeliveries.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No delivery attempts recorded for this webhook yet.
                    </p>
                  ) : expandedDeliveries ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {expandedDeliveries.map((d) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                        >
                          <Badge variant={deliveryBadgeVariant(d.status)} size="sm" dot>
                            {d.status}
                          </Badge>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Event <span className="font-mono">{truncateHash(d.eventId)}</span>
                          </span>
                          {d.statusCode !== null && d.statusCode !== undefined && (
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              HTTP {d.statusCode}
                            </span>
                          )}
                          <span className="text-xs text-slate-400">Attempt {d.attempt}</span>
                          <time
                            dateTime={d.createdAt}
                            className="ml-auto text-xs text-slate-400 dark:text-slate-500"
                          >
                            {formatTimeAgo(new Date(d.createdAt))}
                          </time>
                          {d.status === 'FAILED' && d.error && (
                            <p className="w-full truncate text-xs text-red-500" title={d.error}>
                              {d.error}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
