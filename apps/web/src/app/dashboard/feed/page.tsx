'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import { Badge, FilterBar, SearchInput, StatusDot, Card, EmptyState, cn } from '@mizpah-pulse/ui';
import type { EventCategory, LiveEvent } from '@mizpah-pulse/types';
import { formatTimeAgo } from '@/lib/date-utils';
import { truncateAddress } from '@/lib/display-utils';
import { formatCompactNumber } from '@/lib/format-number';
import { MAX_EVENT_BUFFER } from '@/lib/constants';
import { serializeEventsToCsv, eventsCsvFilename, downloadCsv } from '@/lib/csv-export';
import { prefersReducedMotion } from '@/lib/reduced-motion';
import {
  Activity,
  ArrowUpDown,
  Check,
  Download,
  Filter,
  RefreshCw,
  SlidersHorizontal,
  X,
  Zap,
  Radio,
} from 'lucide-react';
import { useCallback } from 'react';

/** Maximum number of events to keep in the buffer (from shared constants) */

interface FeedEvent {
  id: string;
  type: string;
  category: EventCategory | string;
  title: string;
  from: string;
  to?: string;
  amount?: string;
  time: string;
  status: 'success' | 'error' | 'warning' | 'info';
  timestamp: number;
}

const statusDotColors: Record<string, string> = {
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
};

/** Sample events used by the simulation mode (keeps demos live without infra) */
const SAMPLE_ACCOUNTS = [
  'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GKLM1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GNOP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
];

const SAMPLE_TEMPLATES: Array<Omit<FeedEvent, 'id' | 'time' | 'timestamp'>> = [
  {
    type: 'PAYMENT',
    category: 'PAYMENT',
    title: 'Payment: 125 XLM',
    from: 'GABC…XYZ',
    amount: '125 XLM',
    status: 'success',
  },
  {
    type: 'DEX_TRADE',
    category: 'DEX',
    title: 'DEX Trade: USDC/XLM',
    from: 'GDEF…UVW',
    amount: '500 USDC',
    status: 'success',
  },
  {
    type: 'SOROBAN_INVOKE',
    category: 'CONTRACT',
    title: 'Contract Call: swap()',
    from: 'GHIJ…RST',
    status: 'info',
  },
  {
    type: 'NFT_TRANSFER',
    category: 'NFT',
    title: 'NFT Transfer: #1234',
    from: 'GKLM…NOP',
    to: 'GABC…XYZ',
    status: 'success',
  },
  {
    type: 'CREATE_ACCOUNT',
    category: 'ACCOUNT',
    title: 'Account Created',
    from: 'GNOP…TUV',
    amount: '10 XLM',
    status: 'success',
  },
  {
    type: 'TOKEN_TRANSFER',
    category: 'TOKEN',
    title: 'Token Transfer: 2,000 USDC',
    from: 'GQRW…VWX',
    amount: '2,000 USDC',
    status: 'success',
  },
  {
    type: 'LIQUIDITY_POOL_DEPOSIT',
    category: 'LIQUIDITY',
    title: 'LP Deposit: XLM+USDC',
    from: 'GSTU…YZA',
    amount: '800 XLM',
    status: 'warning',
  },
  {
    type: 'SOROBAN_DEPLOY',
    category: 'CONTRACT',
    title: 'Contract Deployed',
    from: 'GBCD…EFG',
    status: 'info',
  },
  {
    type: 'MANAGE_SELL_OFFER',
    category: 'DEX',
    title: 'Sell Offer: 300 XLM',
    from: 'GHIJ…RST',
    amount: '300 XLM',
    status: 'success',
  },
  {
    type: 'CLAWBACK',
    category: 'TOKEN',
    title: 'Clawback: 50 USDC',
    from: 'GKLM…NOP',
    amount: '50 USDC',
    status: 'error',
  },
];

const categoryVariantMap: Record<string, string> = {
  PAYMENT: 'success',
  ACCOUNT: 'info',
  DEX: 'purple',
  NFT: 'pink',
  TOKEN: 'amber',
  CONTRACT: 'info',
  SYSTEM: 'default',
  GOVERNANCE: 'warning',
  LIQUIDITY: 'info',
  UNKNOWN: 'default',
};

const FEED_STORAGE_KEY = 'mizpahpulse.feed.v1';

/** Load previously persisted feed events from localStorage (guarded for SSR/quota). */
function loadPersistedEvents(): FeedEvent[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(FEED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is FeedEvent => {
      const cand = e as Partial<FeedEvent>;
      return (
        typeof cand?.id === 'string' &&
        typeof cand?.title === 'string' &&
        typeof cand?.timestamp === 'number'
      );
    });
  } catch {
    return [];
  }
}

const categoryOptions = [
  { label: 'All', value: 'all' },
  { label: 'Payments', value: 'PAYMENT' },
  { label: 'Contracts', value: 'CONTRACT' },
  { label: 'DEX', value: 'DEX' },
  { label: 'NFTs', value: 'NFT' },
  { label: 'Tokens', value: 'TOKEN' },
  { label: 'Accounts', value: 'ACCOUNT' },
  { label: 'Liquidity', value: 'LIQUIDITY' },
  { label: 'Governance', value: 'GOVERNANCE' },
];

/**
 * Build a human-readable title from a WebSocket event
 */
function buildEventTitle(event: LiveEvent): string {
  const data = event.data as Record<string, unknown> | undefined;
  const eventType = event.eventType;

  switch (eventType) {
    case 'PAYMENT':
      return `Payment: ${data?.amount || '?'} ${data?.assetCode || 'XLM'}`;
    case 'SOROBAN_INVOKE':
      return `Contract Call: ${(data?.functionName as string) || 'invoke()'}`;
    case 'SOROBAN_DEPLOY':
      return 'Contract Deployed';
    case 'SOROBAN_EVENT':
      return `Contract Event: ${(data?.eventName as string) || 'unknown'}`;
    case 'DEX_TRADE':
      return `DEX Trade: ${data?.sellingAsset || '?'}/${data?.buyingAsset || '?'}`;
    case 'NFT_TRANSFER':
      return `NFT Transfer: #${data?.tokenId || '?'}`;
    case 'NFT_MINT':
      return `NFT Minted: #${data?.tokenId || '?'}`;
    case 'TOKEN_TRANSFER':
      return `Token Transfer: ${data?.amount || '?'} ${data?.assetCode || ''}`;
    case 'CREATE_ACCOUNT':
      return 'Account Created';
    case 'ACCOUNT_MERGE':
      return 'Account Merged';
    case 'LIQUIDITY_POOL_DEPOSIT':
      return 'LP Deposit';
    case 'LIQUIDITY_POOL_WITHDRAW':
      return 'LP Withdrawal';
    case 'MANAGE_BUY_OFFER':
      return 'Buy Offer';
    case 'MANAGE_SELL_OFFER':
      return 'Sell Offer';
    case 'CLAWBACK':
      return 'Clawback';
    default:
      return eventType.replace(/_/g, ' ');
  }
}

export default function FeedPage() {
  const {
    isConnected: wsConnected,
    everConnected,
    lastEvent,
    reconnect,
  } = useWebSocket({
    enabled: true,
  });
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const [copiedEventId, setCopiedEventId] = useState<string | null>(null);
  const [reconnectBannerDismissed, setReconnectBannerDismissed] = useState(false);

  // Rate-limited screen-reader announcements: live arrivals are coalesced and
  // announced as a single count after a short quiet window (see #24).
  const [pendingAnnouncements, setPendingAnnouncements] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState<string | null>(null);
  const announcementTimerRef = useRef<number | null>(null);

  /** Append an event to the buffer and count it towards the next live announcement. */
  const prependEvent = useCallback((event: FeedEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENT_BUFFER));
    setPendingAnnouncements((count) => count + 1);
  }, []);

  // Reset banner dismissal whenever the socket (re)connects so a future drop
  // surfaces the banner again.
  useEffect(() => {
    if (wsConnected) setReconnectBannerDismissed(false);
  }, [wsConnected]);

  // Restore previously persisted events once on mount (before any new events arrive).
  useEffect(() => {
    const restored = loadPersistedEvents();
    if (restored.length > 0) {
      idCounter.current = restored.length;
      setEvents(restored.slice(0, MAX_EVENT_BUFFER));
    }
  }, []);

  // Persist the current buffer to localStorage (best-effort, quota-safe).
  useEffect(() => {
    if (events.length === 0) return;
    try {
      window.localStorage.setItem(FEED_STORAGE_KEY, JSON.stringify(events.slice(0, 50)));
    } catch {
      // Storage full or unavailable — persistence is best-effort only.
    }
  }, [events]);

  // Coalesce live arrivals into a single rate-limited polite announcement.
  useEffect(() => {
    if (pendingAnnouncements === 0 || isPaused) return;

    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current);
    }
    announcementTimerRef.current = window.setTimeout(() => {
      announcementTimerRef.current = null;
      const count = pendingAnnouncements;
      setLiveAnnouncement(`${count} new event${count === 1 ? '' : 's'} added to the live feed`);
      setPendingAnnouncements(0);
    }, 1200);

    return () => {
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current);
        announcementTimerRef.current = null;
      }
    };
  }, [pendingAnnouncements, isPaused]);

  // While the feed is paused, announcements are suppressed entirely: cancel any
  // scheduled flush and drop counts that accumulated during the pause.
  useEffect(() => {
    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current);
      announcementTimerRef.current = null;
    }
    setPendingAnnouncements(0);
    setLiveAnnouncement(null);
  }, [isPaused]);

  // ── URL deep-linking (#7): filters are reflected in (and restored from) the
  // query string so a feed state can be shared/bookmarked and survives reloads.
  useEffect(() => {
    const readFiltersFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q !== null) setSearch(q);
      const categories = params.getAll('category');
      if (categories.length > 0) setSelectedCategories(categories);
      const sort = params.get('sort');
      if (sort === 'asc' || sort === 'desc') setSortOrder(sort);
    };

    readFiltersFromUrl();
    window.addEventListener('popstate', readFiltersFromUrl);
    return () => window.removeEventListener('popstate', readFiltersFromUrl);
  }, []);

  // Debounced sync of the current filters into the URL (replaceState keeps the
  // browser history tidy while typing).
  const urlSyncTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (urlSyncTimerRef.current !== null) window.clearTimeout(urlSyncTimerRef.current);
    urlSyncTimerRef.current = window.setTimeout(() => {
      urlSyncTimerRef.current = null;
      try {
        const params = new URLSearchParams();
        if (search) params.set('q', search);
        selectedCategories.forEach((category) => params.append('category', category));
        if (sortOrder !== 'desc') params.set('sort', sortOrder);
        const qs = params.toString();
        const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
        window.history.replaceState(null, '', url);
      } catch {
        // History API unavailable — deep-linking is progressive enhancement.
      }
    }, 300);
    return () => {
      if (urlSyncTimerRef.current !== null) window.clearTimeout(urlSyncTimerRef.current);
    };
  }, [search, selectedCategories, sortOrder]);

  const clearFeed = useCallback(() => {
    setEvents([]);
    try {
      window.localStorage.removeItem(FEED_STORAGE_KEY);
    } catch {
      // Ignore storage failures
    }
  }, []);

  const copyEvent = useCallback(async (event: FeedEvent) => {
    const payload = JSON.stringify(
      {
        id: event.id,
        type: event.type,
        category: event.category,
        title: event.title,
        from: event.from,
        to: event.to,
        amount: event.amount,
        timestamp: new Date(event.timestamp).toISOString(),
      },
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedEventId(event.id);
      setTimeout(() => setCopiedEventId((id) => (id === event.id ? null : id)), 1500);
    } catch {
      // Clipboard access may be denied — fail silently.
    }
  }, []);

  // Process incoming WebSocket events
  useEffect(() => {
    if (!lastEvent) return;

    const rawEvent = lastEvent as LiveEvent;
    const category =
      ((rawEvent.data as Record<string, unknown> | undefined)?.category as string) || 'UNKNOWN';
    const accountId =
      ((rawEvent.data as Record<string, unknown> | undefined)?.accountId as string) || '';
    const title = buildEventTitle(rawEvent);

    const feedEvent: FeedEvent = {
      id: `evt-${++idCounter.current}-${Date.now()}`,
      type: rawEvent.eventType,
      category: category,
      title,
      from: accountId ? truncateAddress(accountId) : '—',
      to: (rawEvent.data as Record<string, unknown> | undefined)?.to as string | undefined,
      amount: (rawEvent.data as Record<string, unknown> | undefined)?.amount as string | undefined,
      time: 'just now',
      status: 'success',
      timestamp: Date.now(),
    };

    prependEvent(feedEvent);
  }, [lastEvent, prependEvent]);

  // Simulation mode: emit realistic sample events when no WebSocket is available
  useEffect(() => {
    if (!simulating) return;
    const interval = setInterval(() => {
      const template = SAMPLE_TEMPLATES[Math.floor(Math.random() * SAMPLE_TEMPLATES.length)];
      const account = SAMPLE_ACCOUNTS[Math.floor(Math.random() * SAMPLE_ACCOUNTS.length)];
      prependEvent({
        ...template,
        id: `sim-${++idCounter.current}-${Date.now()}`,
        from: template.from.startsWith('G')
          ? truncateAddress(template.from)
          : account.slice(0, 4) + '…' + account.slice(-3),
        time: 'just now',
        timestamp: Date.now(),
      });
    }, 2_500);
    return () => clearInterval(interval);
  }, [simulating, prependEvent]);

  // Update relative timestamps every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setEvents((prev) =>
        prev.map((e) => ({
          ...e,
          time: formatTimeAgo(new Date(e.timestamp)),
        })),
      );
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom (smooth unless the user prefers reduced motion)
  useEffect(() => {
    if (autoScroll && !isPaused && feedEndRef.current) {
      feedEndRef.current.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [events, autoScroll, isPaused]);

  // Filter and sort
  const filteredEvents = events.filter((event) => {
    if (selectedCategories.length > 0 && !selectedCategories.includes(event.category)) return false;
    if (
      search &&
      !event.title.toLowerCase().includes(search.toLowerCase()) &&
      !event.from.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    return true;
  });

  const sortedEvents = sortOrder === 'desc' ? filteredEvents : [...filteredEvents].reverse();

  // Export the currently filtered/sorted events as a CSV download (#15).
  const exportCsv = useCallback(() => {
    const rows = sortedEvents.map((event) => ({
      eventType: event.type,
      category: event.category,
      account: event.from,
      amount: event.amount,
      timestamp: new Date(event.timestamp).toISOString(),
    }));
    downloadCsv(eventsCsvFilename(), serializeEventsToCsv(rows));
  }, [sortedEvents]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100" id="feed-heading">
            Live Activity Feed
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Real-time Stellar blockchain events stream
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot
            status={wsConnected ? 'online' : 'offline'}
            label={wsConnected ? 'Live' : 'Disconnected'}
            pulse={wsConnected}
          />
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              !isPaused
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
            )}
            aria-label={isPaused ? 'Resume live feed' : 'Pause live feed'}
            aria-pressed={isPaused}
          >
            {isPaused ? 'Paused' : 'Live'}
          </button>
          {!wsConnected && events.length === 0 && (
            <button
              onClick={() => setSimulating((s) => !s)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                simulating
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
              aria-pressed={simulating}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              {simulating ? 'Simulating…' : 'Simulate events'}
            </button>
          )}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              autoScroll
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
            )}
            aria-label={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            Auto-scroll {autoScroll ? 'ON' : 'OFF'}
          </button>
          {events.length > 0 && (
            <button
              onClick={clearFeed}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              aria-label="Clear feed"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Reconnecting banner — shown once a live connection drops */}
      {!wsConnected && (everConnected || events.length > 0) && !reconnectBannerDismissed && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950"
        >
          <RefreshCw
            className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
            Connection to the live event stream was lost.{' '}
            <span className="font-semibold">Reconnecting…</span>
          </p>
          <button
            onClick={reconnect}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-300 dark:hover:bg-amber-950"
          >
            Retry now
          </button>
          <button
            onClick={() => setReconnectBannerDismissed(true)}
            className="rounded-lg p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900"
            aria-label="Dismiss reconnecting banner"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'WS Status', value: wsConnected ? 'Connected' : 'Offline', icon: Radio },
          { label: 'Events Buffer', value: formatCompactNumber(events.length), icon: Activity },
          { label: 'Filtered', value: String(sortedEvents.length), icon: Filter },
          { label: 'Sort', value: sortOrder === 'desc' ? 'Newest' : 'Oldest', icon: ArrowUpDown },
        ].map((stat) => (
          <Card key={stat.label} padding="sm">
            <div className="flex items-center gap-2">
              <stat.icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {stat.label}
                </p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{stat.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by address, hash, or event type..."
          className="w-full sm:w-80"
        />
        <FilterBar
          options={categoryOptions}
          selected={selectedCategories}
          onChange={setSelectedCategories}
          label="Category"
        />
        <button
          onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label={`Sort ${sortOrder === 'desc' ? 'oldest first' : 'newest first'}`}
        >
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
        </button>
        <button
          onClick={exportCsv}
          disabled={sortedEvents.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          aria-label="Export filtered events as CSV"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {/* Screen-reader announcement region for live feed updates. The feed
          itself is intentionally NOT aria-live (inserting every event would
          flood assistive tech); arrivals are announced here as a single
          rate-limited count instead. */}
      <p aria-live="polite" role="status" className="sr-only">
        {liveAnnouncement}
      </p>

      {/* Event Feed */}
      <div
        className="space-y-2"
        role="feed"
        aria-label="Blockchain event feed"
        aria-busy={!wsConnected}
      >
        {!wsConnected && events.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Radio className="h-10 w-10" />}
              title="Connecting to event stream..."
              description="Waiting for WebSocket connection to the blockchain event server"
            />
          </Card>
        ) : sortedEvents.length === 0 ? (
          <Card>
            <EmptyState
              icon={<SlidersHorizontal className="h-10 w-10" />}
              title="No events match your filters"
              description="Try adjusting your search or category filters"
            />
          </Card>
        ) : (
          sortedEvents.map((event, idx) => (
            <article
              key={event.id}
              className="feed-item group flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4 transition-all duration-200 hover:border-slate-200 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              style={{ animationDelay: `${idx * 30}ms` }}
              role="article"
              aria-label={`${event.type} event: ${event.title}`}
            >
              {/* Status dot */}
              <span
                className={cn(
                  'h-3 w-3 flex-shrink-0 rounded-full ring-4 ring-opacity-20',
                  statusDotColors[event.status],
                  event.status === 'success' && 'ring-emerald-100 dark:ring-emerald-900',
                  event.status === 'error' && 'ring-red-100 dark:ring-red-900',
                  event.status === 'warning' && 'ring-amber-100 dark:ring-amber-900',
                )}
                aria-hidden="true"
              />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {event.title}
                  </span>
                  <Badge
                    variant={
                      (categoryVariantMap[event.category] || 'default') as
                        | 'success'
                        | 'info'
                        | 'purple'
                        | 'pink'
                        | 'amber'
                        | 'warning'
                        | 'error'
                        | 'default'
                    }
                  >
                    {event.category}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono">{event.from}</span>
                  {event.to && (
                    <>
                      <span aria-hidden="true">→</span>
                      <span className="font-mono">{event.to}</span>
                    </>
                  )}
                  {event.amount && (
                    <>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        •
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        {event.amount}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Time */}
              <div className="flex-shrink-0 text-right">
                <time
                  className="text-xs text-slate-400 dark:text-slate-500"
                  dateTime={new Date(event.timestamp).toISOString()}
                >
                  {event.time}
                </time>
              </div>

              {/* Hover action: copy the raw event JSON */}
              <button
                onClick={() => void copyEvent(event)}
                className="hidden rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-slate-100 hover:text-indigo-500 group-hover:block dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-indigo-400"
                aria-label={`Copy ${event.type} event JSON`}
                title="Copy event JSON"
              >
                {copiedEventId === event.id ? (
                  <Check className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                ) : (
                  <Zap className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </article>
          ))
        )}
        <div ref={feedEndRef} />
      </div>
    </div>
  );
}
