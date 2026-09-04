/**
 * Component tests for the analytics page range selector (issue #16):
 *  - renders 24h/7d/30d selector buttons
 *  - default range queries the hourly timeseries endpoint
 *  - switching range re-queries with day granularity and the right params
 *  - loading skeletons render while the range refetch is in flight
 *  - falls back to sample data when the API is unavailable
 *
 * The page talks to the API through apiFetch, so the global fetch is stubbed
 * with the standard `{ success, data }` envelope.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnalyticsPage from '@/app/dashboard/analytics/page';

const fetchMock = vi.fn();

function envelope(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { success: true, data } : { success: false }),
  };
}

function stats() {
  return {
    totalEvents: 8432,
    eventsLast24h: 1247,
    uniqueAccounts: 3847,
    trackedContracts: 156,
    topAccounts: [],
    recentActivity: [],
  };
}

function eventsPage(total = 3) {
  const events = Array.from({ length: total }).map((_, i) => ({
    id: `evt-${i}`,
    eventType: 'PAYMENT',
    category: 'PAYMENT',
    timestamp: new Date(Date.now() - i * 60_000).toISOString(),
    accountId: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  }));
  return { events, total, limit: 500, hasMore: false };
}

function timeseries(bucketCount = 25) {
  const buckets = Array.from({ length: bucketCount }).map((_, i) => ({
    start: new Date(`2026-09-03T${String(i % 24).padStart(2, '0')}:00:00.000Z`).toISOString(),
    label: `${String(i % 24).padStart(2, '0')}:00`,
    counts: { PAYMENT: i === 5 ? 10 : 0, DEX: 0 },
    total: i === 5 ? 10 : 0,
  }));
  return { granularity: 'hour', range: '24h', totalEvents: 10, buckets };
}

async function renderLoaded() {
  fetchMock.mockResolvedValueOnce(envelope(stats()));
  fetchMock.mockResolvedValueOnce(envelope(eventsPage()));
  fetchMock.mockResolvedValueOnce(envelope(timeseries()));
  vi.stubGlobal('fetch', fetchMock);
  render(<AnalyticsPage />);
  await screen.findByRole('heading', { name: 'Activity Over Time' });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
}

describe('AnalyticsPage time-range selector (#16)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('renders 24h/7d/30d selector buttons with 24h active by default', async () => {
    await renderLoaded();

    const group = screen.getByRole('group', { name: 'Time range' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Last 24 hours')).toBeInTheDocument();
  });

  it('queries the hourly timeseries endpoint for the default 24h range', async () => {
    await renderLoaded();

    const timeseriesCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/api/v1/stats/timeseries'),
    );
    expect(timeseriesCall).toBeDefined();
    expect(String(timeseriesCall![0])).toContain('granularity=hour&range=24h');
  });

  it('re-queries with day granularity when switching to 7d', async () => {
    await renderLoaded();

    fetchMock.mockResolvedValueOnce(envelope(stats()));
    fetchMock.mockResolvedValueOnce(envelope(eventsPage(2)));
    fetchMock.mockResolvedValueOnce(
      envelope({ granularity: 'day', range: '7d', totalEvents: 2, buckets: [] }),
    );

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/timeseries'))).toHaveLength(
        2,
      ),
    );

    const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/timeseries'));
    expect(String(calls[1][0])).toContain('granularity=day&range=7d');
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('Category Distribution (7d)')).toBeInTheDocument();
  });

  it('switches to 30d and refetches', async () => {
    await renderLoaded();

    fetchMock.mockResolvedValueOnce(envelope(stats()));
    fetchMock.mockResolvedValueOnce(envelope(eventsPage(1)));
    fetchMock.mockResolvedValueOnce(
      envelope({ granularity: 'day', range: '30d', totalEvents: 1, buckets: [] }),
    );

    fireEvent.click(screen.getByRole('button', { name: '30d' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('range=30d'))).toHaveLength(
        1,
      ),
    );
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText('Top Contracts (30d)')).toBeInTheDocument();
  });

  it('shows loading state while the range refetch is in flight', async () => {
    await renderLoaded();

    const resolvers: Array<(value: unknown) => void> = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    // Metric cards report Loading… while the range fetch is unresolved.
    await waitFor(() => expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0));

    // Resolve all three parallel requests (stats, events, timeseries).
    resolvers.splice(0).forEach((resolve, i) => {
      resolve(envelope([envelope(stats()), envelope(eventsPage(0)), envelope(timeseries(0))][i]));
    });
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to sample data when the API is unavailable', async () => {
    fetchMock.mockResolvedValueOnce(envelope(stats()));
    fetchMock.mockResolvedValueOnce(envelope(eventsPage()));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsPage />);

    expect(await screen.findByText(/Showing sample data/)).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument(); // fallback hourly labels
  });
});
