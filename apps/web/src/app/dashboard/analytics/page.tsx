'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, cn, Skeleton } from '@mizpah-pulse/ui';
import { Coins, FileCode, DollarSign, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

type RangeKey = '24h' | '7d' | '30d';

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string }> = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
];

const RANGE_LABELS: Record<RangeKey, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const RANGE_MS: Record<RangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const categoryBarColors: Record<string, string> = {
  PAYMENT: 'bg-emerald-500',
  DEX: 'bg-purple-500',
  CONTRACT: 'bg-indigo-500',
  TOKEN: 'bg-amber-500',
  NFT: 'bg-pink-500',
  ACCOUNT: 'bg-sky-500',
  LIQUIDITY: 'bg-teal-500',
  GOVERNANCE: 'bg-rose-500',
  SYSTEM: 'bg-slate-500',
  UNKNOWN: 'bg-slate-400',
};

const CATEGORY_LABELS: Record<string, string> = {
  PAYMENT: 'Payments',
  DEX: 'DEX',
  CONTRACT: 'Contracts',
  TOKEN: 'Tokens',
  NFT: 'NFTs',
  ACCOUNT: 'Accounts',
  LIQUIDITY: 'Liquidity',
  GOVERNANCE: 'Governance',
  SYSTEM: 'System',
  UNKNOWN: 'Unknown',
};

/** Static fallback dataset used when the live API is unavailable (demo mode). */
const FALLBACK_HOURLY = [
  { hour: '00:00', payments: 45, dex: 12, contracts: 8, nfts: 3, tokens: 22, accounts: 5 },
  { hour: '02:00', payments: 32, dex: 8, contracts: 5, nfts: 2, tokens: 15, accounts: 3 },
  { hour: '04:00', payments: 28, dex: 6, contracts: 3, nfts: 1, tokens: 12, accounts: 2 },
  { hour: '06:00', payments: 55, dex: 15, contracts: 10, nfts: 4, tokens: 28, accounts: 8 },
  { hour: '08:00', payments: 89, dex: 28, contracts: 22, nfts: 8, tokens: 45, accounts: 15 },
  { hour: '10:00', payments: 120, dex: 42, contracts: 35, nfts: 12, tokens: 65, accounts: 22 },
  { hour: '12:00', payments: 145, dex: 52, contracts: 40, nfts: 18, tokens: 78, accounts: 28 },
  { hour: '14:00', payments: 168, dex: 58, contracts: 48, nfts: 22, tokens: 92, accounts: 35 },
  { hour: '16:00', payments: 155, dex: 55, contracts: 42, nfts: 16, tokens: 85, accounts: 30 },
  { hour: '18:00', payments: 132, dex: 45, contracts: 38, nfts: 14, tokens: 72, accounts: 25 },
  { hour: '20:00', payments: 98, dex: 35, contracts: 25, nfts: 9, tokens: 55, accounts: 18 },
  { hour: '22:00', payments: 72, dex: 22, contracts: 15, nfts: 5, tokens: 38, accounts: 12 },
];

const FALLBACK_CATEGORIES = [
  { label: 'Payments', value: 42, color: 'bg-emerald-500' },
  { label: 'DEX', value: 28, color: 'bg-purple-500' },
  { label: 'Contracts', value: 15, color: 'bg-indigo-500' },
  { label: 'Tokens', value: 8, color: 'bg-amber-500' },
  { label: 'NFTs', value: 4, color: 'bg-pink-500' },
  { label: 'Accounts', value: 3, color: 'bg-sky-500' },
];

const FALLBACK_CONTRACTS = [
  { name: 'USDC Token', calls: 842, address: 'CA7G...abc1' },
  { name: 'Aqua DEX Router', calls: 654, address: 'CB3X...def2' },
  { name: 'BLND Lending', calls: 421, address: 'CD9Y...ghi3' },
  { name: 'Mint NFT', calls: 298, address: 'CE2Z...jkl4' },
  { name: 'Staking V2', calls: 187, address: 'CF5W...mno5' },
];

interface StatsData {
  totalEvents: number;
  eventsLast24h: number;
  uniqueAccounts: number;
  trackedContracts: number;
}

interface EventItem {
  id: string;
  eventType: string;
  category: string;
  timestamp: string;
  accountId?: string | null;
  contractId?: string | null;
}

interface EventsPage {
  events: EventItem[];
  total?: number;
}

/** A single bucket in the time-series aggregation from the API. */
export interface TimeseriesBucket {
  start: string;
  label: string;
  counts: Record<string, number>;
  total: number;
}

export interface TimeseriesData {
  granularity: 'hour' | 'day';
  range: RangeKey;
  buckets: TimeseriesBucket[];
}

/**
 * Aggregate category counts into the display shape used by the breakdown card.
 */
function aggregateCategories(events: EventItem[]) {
  const counts = new Map<string, number>();
  for (const evt of events) {
    counts.set(evt.category, (counts.get(evt.category) ?? 0) + 1);
  }
  const total = events.length || 1;
  return [...counts.entries()]
    .map(([category, count]) => ({
      label: CATEGORY_LABELS[category] ?? category,
      value: Math.round((count / total) * 100),
      color: categoryBarColors[category] ?? 'bg-slate-400',
    }))
    .sort((a, b) => b.value - a.value);
}

/** Aggregate top contracts from the fetched event window. */
function aggregateTopContracts(events: EventItem[]) {
  const counts = new Map<string, number>();
  for (const evt of events) {
    if (evt.contractId) counts.set(evt.contractId, (counts.get(evt.contractId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([address, calls], idx) => ({
      name: `Contract #${idx + 1}`,
      calls,
      address: address.length > 12 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address,
    }));
}

/** Present-category segments for one bucket, ordered for a stacked bar. */
function toSegments(bucket: { counts: Record<string, number> }) {
  const segments = Object.entries(bucket.counts)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({
      category,
      count,
      color: categoryBarColors[category] ?? 'bg-slate-400',
    }));
  if (segments.length === 0) return segments;
  return segments.sort((a, b) => b.count - a.count);
}

/** Fallback per-bucket series for a range when the API is unavailable. */
function fallbackBuckets(
  range: RangeKey,
): Array<{ label: string; counts: Record<string, number>; start?: string }> {
  if (range === '24h') {
    return FALLBACK_HOURLY.map((h) => ({
      label: h.hour,
      counts: {
        PAYMENT: h.payments,
        DEX: h.dex,
        CONTRACT: h.contracts,
        NFT: h.nfts,
        TOKEN: h.tokens,
        ACCOUNT: h.accounts,
      },
    }));
  }
  const count = range === '7d' ? 7 : 30;
  const base = new Date();
  return Array.from({ length: count }).map((_, i) => {
    const day = new Date(base.getTime() - (count - 1 - i) * 24 * 60 * 60 * 1000);
    const factor = 0.6 + (0.4 * (count - 1 - i)) / Math.max(1, count - 1); // grows toward "today"
    return {
      label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      counts: {
        PAYMENT: Math.round(120 * factor),
        DEX: Math.round(40 * factor),
        CONTRACT: Math.round(30 * factor),
        TOKEN: Math.round(20 * factor),
      },
    };
  });
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>('24h');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [rangeTotal, setRangeTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'sample'>('loading');
  const [buckets, setBuckets] = useState<
    Array<{ label: string; counts: Record<string, number>; start?: string }>
  >([]);
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [topContracts, setTopContracts] = useState(FALLBACK_CONTRACTS);

  const loadAnalytics = useCallback(async (selected: RangeKey, signal?: AbortSignal) => {
    setLoading(true);
    setChartLoading(true);
    const granularity = selected === '24h' ? 'hour' : 'day';
    const startDate = encodeURIComponent(new Date(Date.now() - RANGE_MS[selected]).toISOString());
    try {
      const [statsBody, eventsBody, seriesBody] = await Promise.all([
        apiFetch<StatsData>('/api/v1/stats', { signal }),
        apiFetch<EventsPage>(`/api/v1/events?limit=500&startDate=${startDate}`, { signal }),
        apiFetch<TimeseriesData>(
          `/api/v1/stats/timeseries?granularity=${granularity}&range=${selected}`,
          { signal },
        ),
      ]);
      if (signal?.aborted) return;
      setStats(statsBody);
      const events = eventsBody.events ?? [];
      setRangeTotal(typeof eventsBody.total === 'number' ? eventsBody.total : null);
      setCategories(aggregateCategories(events));
      setTopContracts(aggregateTopContracts(events));
      setBuckets(
        (seriesBody.buckets ?? []).map((b) => ({
          label: b.label,
          counts: b.counts,
          start: b.start,
        })),
      );
      setDataSource('live');
    } catch {
      // API unavailable — keep the sample dataset for demo purposes.
      if (!signal?.aborted) {
        setBuckets(fallbackBuckets(selected));
        setDataSource('sample');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setChartLoading(false);
      }
    }
  }, []);

  // (Re)load whenever the selected range changes (#16).
  useEffect(() => {
    const controller = new AbortController();
    void loadAnalytics(range, controller.signal);
    return () => controller.abort();
  }, [range, loadAnalytics]);

  const maxTotal = Math.max(
    0,
    ...buckets.map((b) => {
      const counts = b.counts as Record<string, number>;
      return Object.values(counts).reduce((sum, n) => sum + n, 0);
    }),
  );

  const metricCards = [
    {
      label: `Events (${range})`,
      value: rangeTotal?.toLocaleString() ?? stats?.eventsLast24h?.toLocaleString() ?? '1,247',
      icon: DollarSign,
      trend: 'up' as const,
    },
    {
      label: 'Total Events',
      value: stats?.totalEvents?.toLocaleString() ?? '8,432',
      icon: Users,
      trend: 'up' as const,
    },
    {
      label: 'Tracked Contracts',
      value: stats?.trackedContracts?.toLocaleString() ?? '156',
      icon: Coins,
      trend: 'up' as const,
    },
    {
      label: 'Unique Accounts',
      value: stats?.uniqueAccounts?.toLocaleString() ?? '3,847',
      icon: FileCode,
      trend: 'up' as const,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Stellar network insights and historical trends
        </p>
        {dataSource === 'sample' && !loading && (
          <p
            role="status"
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
            Showing sample data — live API unavailable
            <button
              onClick={() => void loadAnalytics(range)}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </p>
        )}
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricCards.map((metric) => (
          <Card key={metric.label} padding="lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {metric.label}
                </p>
                <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {loading ? <Skeleton className="h-8 w-20" /> : metric.value}
                </div>
              </div>{' '}
              <metric.icon className="h-5 w-5 text-slate-300 dark:text-slate-600" />
            </div>
            <p className={cn('mt-2 text-xs font-medium', 'text-emerald-600 dark:text-emerald-400')}>
              {loading ? 'Loading…' : dataSource === 'live' ? 'Live from API' : 'Sample data'}
            </p>
          </Card>
        ))}
      </div>

      {/* Activity Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Activity Over Time
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{RANGE_LABELS[range]}</p>
            </div>
            {/* Time-range selector (#16) */}
            <div
              role="group"
              aria-label="Time range"
              className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
            >
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  onClick={() => setRange(option.key)}
                  aria-pressed={range === option.key}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                    range === option.key
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              'space-y-1',
              buckets.length > 14 ? 'max-h-80 overflow-y-auto pr-1' : 'h-64',
            )}
          >
            {chartLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))
            ) : buckets.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No events in the {RANGE_LABELS[range].toLowerCase()} to chart.
              </p>
            ) : (
              buckets.map((bucket) => {
                const segments = toSegments(bucket);
                const total = segments.reduce((sum, s) => sum + s.count, 0);
                const width =
                  maxTotal > 0 ? Math.max((total / maxTotal) * 100, total > 0 ? 2 : 0) : 0;
                return (
                  <div
                    key={`${bucket.label}-${bucket.start ?? ''}`}
                    className="flex items-center gap-3"
                  >
                    <span className="w-12 flex-shrink-0 text-right text-[10px] text-slate-400">
                      {bucket.label}
                    </span>
                    <div className="flex h-5 flex-1 overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                      {segments.length === 0 ? (
                        <div className="h-full w-full" aria-hidden="true" />
                      ) : (
                        segments.map((segment) => (
                          <div
                            key={segment.category}
                            className={`h-full ${segment.color}`}
                            style={{ width: `${(segment.count / Math.max(1, total)) * width}%` }}
                            title={`${CATEGORY_LABELS[segment.category] ?? segment.category}: ${segment.count}`}
                          />
                        ))
                      )}
                    </div>
                    <span className="w-12 flex-shrink-0 text-[10px] text-slate-500 dark:text-slate-400">
                      {total}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Category Distribution ({range})
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categories.length === 0 && !loading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No events in the {RANGE_LABELS[range].toLowerCase()} to aggregate.
                </p>
              ) : (
                categories.map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-sm ${item.color}`} />
                    <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                      {item.label}
                    </span>
                    <span className="text-sm font-mono text-slate-500 dark:text-slate-400">
                      {item.value}%
                    </span>
                    <div className="w-32">
                      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className={`h-2 rounded-full ${item.color}`}
                          style={{ width: `${item.value}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Top Contracts ({range})
            </h2>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topContracts.length === 0 && !loading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No contract activity in the {RANGE_LABELS[range].toLowerCase()}.
                </p>
              ) : (
                topContracts.map((contract, idx) => (
                  <div
                    key={`${contract.address}-${idx}`}
                    className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {contract.name}
                      </p>
                      <p className="text-xs font-mono text-slate-400">{contract.address}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {contract.calls.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400">calls</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
