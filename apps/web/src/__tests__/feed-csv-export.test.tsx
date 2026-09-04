/**
 * Component tests for the feed CSV export (issue #15):
 *  - Export CSV is disabled while the filtered list is empty
 *  - once events are present it serializes the filtered rows into a download
 *
 * The feed page pulls events from useWebSocket, which is mocked at the hook
 * boundary (same pattern as feed-page-component.test.tsx).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedPage from '@/app/dashboard/feed/page';

const hookMock = vi.hoisted(() => {
  let state = {
    isConnected: false,
    everConnected: false,
    lastEvent: null as unknown,
    connectionStats: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    reconnect: vi.fn(),
  };
  return {
    useWebSocket: vi.fn(() => state),
    setState: (partial: Partial<typeof state>) => {
      state = { ...state, ...partial };
    },
    reset: () => {
      state = {
        isConnected: false,
        everConnected: false,
        lastEvent: null,
        connectionStats: null,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        reconnect: vi.fn(),
      };
    },
  };
});

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: hookMock.useWebSocket,
}));

const originalScrollIntoView = Element.prototype.scrollIntoView;

/**
 * Stub document.createElement so ONLY <a> tags return a click-spy anchor;
 * every other element (React Testing Library's container etc.) keeps the
 * real implementation so rendering still works.
 */
/** Read a Blob as text without relying on Blob#text (absent in jsdom). */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function stubAnchorClick(click: ReturnType<typeof vi.fn>) {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tagName: string, options?: ElementCreationOptions) => {
      if (String(tagName).toLowerCase() === 'a') {
        const el = realCreateElement('a', options) as HTMLAnchorElement;
        el.click = click;
        return el;
      }
      return realCreateElement(tagName, options);
    },
  );
}

/** Minimal LiveEvent-shaped payload understood by the feed page. */
function liveEvent(eventType: string, data: Record<string, unknown>) {
  return {
    channel: 'events',
    eventType,
    data,
    timestamp: new Date().toISOString(),
    sequence: 1,
  };
}

const PAYMENT = liveEvent('PAYMENT', {
  category: 'PAYMENT',
  accountId: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  amount: '125',
  assetCode: 'XLM',
});

describe('FeedPage CSV export (#15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMock.reset();
    window.localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-csv'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
  });

  it('keeps Export CSV disabled until events are present', () => {
    render(<FeedPage />);

    const button = screen.getByRole('button', { name: 'Export filtered events as CSV' });
    expect(button).toBeDisabled();
  });

  it('downloads a CSV of the current filtered events when clicked', async () => {
    const click = vi.fn();
    stubAnchorClick(click);
    const createObjectURL = vi.mocked(URL.createObjectURL);

    const { rerender } = render(<FeedPage />);
    hookMock.setState({ isConnected: true, everConnected: true, lastEvent: PAYMENT });
    rerender(<FeedPage />);

    const button = await screen.findByRole('button', { name: 'Export filtered events as CSV' });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    // The anchor that was clicked carries a date-stamped .csv filename (#15).
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(
      /^mizpahpulse-events-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    // The Blob contains the header plus a PAYMENT row with the truncated account.
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await blobText(blob);
    expect(text).toContain('eventType,category,account,amount,timestamp');
    expect(text).toContain('PAYMENT');
    expect(text).toContain('GABC');

    // Let the deferred object-URL revocation run while the stub is installed.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-csv');
  });

  it('exports only the events matching the active category filter', async () => {
    const click = vi.fn();
    stubAnchorClick(click);
    const createObjectURL = vi.mocked(URL.createObjectURL);

    const TRADE = liveEvent('DEX_TRADE', {
      category: 'DEX',
      accountId: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      sellingAsset: 'XLM',
      buyingAsset: 'USDC',
    });

    const { rerender } = render(<FeedPage />);
    hookMock.setState({ isConnected: true, everConnected: true, lastEvent: PAYMENT });
    rerender(<FeedPage />);
    hookMock.setState({ lastEvent: TRADE });
    rerender(<FeedPage />);

    // Filter to DEX only.
    fireEvent.click(await screen.findByRole('button', { name: 'DEX' }));

    fireEvent.click(screen.getByRole('button', { name: 'Export filtered events as CSV' }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await blobText(blob);
    expect(text).toContain('DEX_TRADE');
    expect(text).not.toContain('PAYMENT');

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-csv');
  });
});
