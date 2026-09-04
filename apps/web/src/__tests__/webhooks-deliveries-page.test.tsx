/**
 * Component tests for the webhook delivery-log viewer (issue #17):
 *  - expanding a webhook row fetches /webhooks/:id/deliveries and renders
 *    status badges, HTTP codes, attempt counts, and timestamps
 *  - failure states and error messages render inline
 *  - re-expanding a cached webhook does not refetch
 *
 * The page talks to the API through apiFetch (a thin fetch wrapper), so the
 * global fetch is stubbed with the standard `{ success, data }` envelope.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WebhooksPage from '@/app/dashboard/webhooks/page';

const fetchMock = vi.fn();

function envelope(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { success: true, data } : { success: false }),
  };
}

function apiWebhook(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'wh-1',
    endpoint: 'https://example.com/hook',
    events: ['PAYMENT'],
    isActive: true,
    failedDeliveries: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastDeliveryAt: null,
    deliveries: [],
    ...overrides,
  };
}

function delivery(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'del-1',
    subscriptionId: 'wh-1',
    eventId: 'evt-abc123',
    status: 'SUCCESS',
    statusCode: 200,
    attempt: 1,
    error: null,
    createdAt: '2026-09-04T10:00:00.000Z',
    completedAt: '2026-09-04T10:00:00.000Z',
    ...overrides,
  };
}

function deliveryEnvelope(items: unknown[]) {
  return {
    data: items,
    pagination: { page: 1, limit: 10, total: items.length, totalPages: 1 },
  };
}

async function renderWithWebhook() {
  fetchMock.mockResolvedValue(envelope([apiWebhook()]));
  vi.stubGlobal('fetch', fetchMock);
  render(<WebhooksPage />);
  await screen.findByText('https://example.com/hook');
}

describe('WebhooksPage delivery log viewer (#17)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('fetches and renders deliveries when a row is expanded', async () => {
    await renderWithWebhook();

    // Subsequent fetches (the expansion) serve the deliveries payload.
    fetchMock.mockResolvedValue(envelope(deliveryEnvelope([delivery()])));

    fireEvent.click(screen.getByRole('button', { name: 'Delivery log' }));

    // The viewer fetches the dedicated deliveries endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/webhooks/wh-1/deliveries?limit=10',
      expect.anything(),
    );

    expect(await screen.findByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByText('HTTP 200')).toBeInTheDocument();
    expect(screen.getByText('Attempt 1')).toBeInTheDocument();
  });

  it('shows the error message for failed deliveries', async () => {
    await renderWithWebhook();

    fetchMock.mockResolvedValue(
      envelope(
        deliveryEnvelope([
          delivery({
            id: 'del-2',
            status: 'FAILED',
            statusCode: 502,
            error: 'Upstream returned 502 Bad Gateway',
          }),
        ]),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delivery log' }));

    expect(await screen.findByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('HTTP 502')).toBeInTheDocument();
    expect(screen.getByText('Upstream returned 502 Bad Gateway')).toBeInTheDocument();
  });

  it('shows an empty state when no deliveries exist', async () => {
    await renderWithWebhook();

    fetchMock.mockResolvedValue(envelope(deliveryEnvelope([])));

    fireEvent.click(screen.getByRole('button', { name: 'Delivery log' }));

    expect(
      await screen.findByText('No delivery attempts recorded for this webhook yet.'),
    ).toBeInTheDocument();
  });

  it('surfaces a fetch error inline when the deliveries call fails', async () => {
    await renderWithWebhook();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: 'deliveries down' } }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delivery log' }));

    expect(await screen.findByText('deliveries down')).toBeInTheDocument();
  });

  it('collapses the log and re-expanding does not refetch cached rows', async () => {
    await renderWithWebhook();

    fetchMock.mockResolvedValue(envelope(deliveryEnvelope([delivery()])));

    const toggle = screen.getByRole('button', { name: 'Delivery log' });
    fireEvent.click(toggle);
    await screen.findByText('SUCCESS');

    // Collapse, then expand again — the fetch should not repeat (cached).
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument());
    fireEvent.click(toggle);

    expect(await screen.findByText('SUCCESS')).toBeInTheDocument();
    const deliveriesCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/deliveries'),
    );
    expect(deliveriesCalls).toHaveLength(1);
  });
});
