/**
 * Component tests for the functional settings page (issue #11):
 *  - loads and seeds existing preferences into the form
 *  - saving PATCHes the preferences and shows a saved state
 *  - load/save errors render inline with retry affordances
 *
 * The page talks to the API through apiFetch, so the global fetch is stubbed
 * with the standard `{ success, data }` envelope.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsPage from '@/app/dashboard/settings/page';

const fetchMock = vi.fn();

function envelope(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { success: true, data } : { success: false }),
  };
}

function preferences(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'default',
    channels: ['websocket'],
    events: ['PAYMENT'],
    enabled: true,
    ...overrides,
  };
}

async function renderLoaded() {
  fetchMock.mockResolvedValue(envelope(preferences()));
  vi.stubGlobal('fetch', fetchMock);
  render(<SettingsPage />);
  await screen.findByRole('button', { name: 'Save preferences' });
}

describe('SettingsPage notification preferences (#11)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('loads saved preferences into the channel and event controls', async () => {
    fetchMock.mockResolvedValue(
      envelope(preferences({ channels: ['websocket', 'email'], events: ['PAYMENT', 'DEX_TRADE'] })),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsPage />);

    expect(await screen.findByRole('button', { name: 'Save preferences' })).toBeInTheDocument();

    const ws = screen.getByLabelText('Channel In-app (WebSocket)') as HTMLInputElement;
    const email = screen.getByLabelText('Channel Email') as HTMLInputElement;
    expect(ws.checked).toBe(true);
    expect(email.checked).toBe(true);

    // Event chips reflect the saved event types.
    expect(screen.getByRole('button', { name: 'Payment events' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'DEX trades' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'NFT activity' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows the API defaults when the user has no saved preferences', async () => {
    // The endpoint returns websocket-only defaults when nothing is saved yet.
    fetchMock.mockResolvedValue(envelope(preferences({ channels: ['websocket'], events: [] })));
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsPage />);

    expect(await screen.findByRole('button', { name: 'Save preferences' })).toBeInTheDocument();
    const ws = screen.getByLabelText('Channel In-app (WebSocket)') as HTMLInputElement;
    expect(ws.checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Payment events' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('PATCHes the form state when saving and shows the saved confirmation', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'DEX trades' })); // select
    fireEvent.click(screen.getByLabelText('Enable notifications')); // toggle off

    fetchMock.mockResolvedValue(
      envelope(preferences({ events: ['PAYMENT', 'DEX_TRADE'], enabled: false })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/preferences',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          channels: ['websocket'],
          events: ['PAYMENT', 'DEX_TRADE'],
          enabled: false,
        }),
      }),
    );
  });

  it('shows a load error with a retry action when the initial fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: 'preferences down' } }),
    });
    fetchMock.mockResolvedValue(envelope(preferences()));
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsPage />);

    expect(await screen.findByText('preferences down')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Save preferences' })).toBeInTheDocument();
  });

  it('shows an inline error when saving fails', async () => {
    await renderLoaded();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { message: 'save failed' } }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('save failed')).toBeInTheDocument();
  });

  it('blocks saving with no channels selected', async () => {
    await renderLoaded();

    const ws = screen.getByLabelText('Channel In-app (WebSocket)') as HTMLInputElement;
    fireEvent.click(ws); // deselect the only channel

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Select at least one notification channel')).toBeInTheDocument();
    // No PATCH was sent.
    await waitFor(
      () =>
        expect(
          fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/v1/preferences')),
        ).toHaveLength(1), // the initial GET only
    );
  });
});
