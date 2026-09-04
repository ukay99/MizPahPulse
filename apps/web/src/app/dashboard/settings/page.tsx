'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, cn, Skeleton } from '@mizpah-pulse/ui';
import { Globe, Bell, Shield, Moon, Check, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';

/** Event types the user can opt into (mirrors the webhook event options). */
const EVENT_OPTIONS = [
  'PAYMENT',
  'DEX_TRADE',
  'SOROBAN_INVOKE',
  'SOROBAN_EVENT',
  'NFT_TRANSFER',
  'TOKEN_TRANSFER',
];

const CHANNELS = ['websocket', 'email'] as const;
type Channel = (typeof CHANNELS)[number];

const CHANNEL_LABELS: Record<Channel, string> = {
  websocket: 'In-app (WebSocket)',
  email: 'Email',
};

const EVENT_LABELS: Record<string, string> = {
  PAYMENT: 'Payment events',
  DEX_TRADE: 'DEX trades',
  SOROBAN_INVOKE: 'Contract invocations',
  SOROBAN_EVENT: 'Contract events',
  NFT_TRANSFER: 'NFT activity',
  TOKEN_TRANSFER: 'Token transfers',
};

export interface Preferences {
  userId: string;
  channels: string[];
  events: string[];
  enabled: boolean;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state (seeded from the loaded preferences).
  const [channels, setChannels] = useState<Channel[]>(['websocket']);
  const [events, setEvents] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<Preferences>('/api/v1/preferences');
      setChannels(
        (data.channels ?? []).filter((c): c is Channel => CHANNELS.includes(c as Channel)),
      );
      setEvents(data.events ?? []);
      setEnabled(data.enabled ?? true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await apiFetch<Preferences>('/api/v1/preferences', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setChannels(
          (data.channels ?? []).filter((c): c is Channel => CHANNELS.includes(c as Channel)),
        );
        setEvents(data.events ?? []);
        setEnabled(data.enabled ?? true);
      } catch (err) {
        if (!controller.signal.aborted) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const toggleChannel = (channel: Channel) => {
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
    if (saveState !== 'idle') setSaveState('idle');
  };

  const toggleEvent = (evt: string) => {
    setEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
    if (saveState !== 'idle') setSaveState('idle');
  };

  const handleSave = async () => {
    if (channels.length === 0) {
      setSaveError('Select at least one notification channel');
      setSaveState('error');
      return;
    }
    setSaving(true);
    setSaveState('saving');
    setSaveError(null);
    try {
      await apiFetch<Preferences>('/api/v1/preferences', {
        method: 'PATCH',
        body: { channels, events, enabled },
      });
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure your MizpahPulse preferences
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Network</h2>
            </div>
          </CardHeader>
          <CardContent>
            <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option>Stellar Testnet</option>
              <option>Stellar Public</option>
              <option>Stellar Futurenet</option>
            </select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Notifications</h2>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              >
                <p>{loadError}</p>
                <button
                  onClick={() => void loadPreferences()}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Master enable toggle */}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Enable notifications
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => {
                      setEnabled(e.target.checked);
                      if (saveState !== 'idle') setSaveState('idle');
                    }}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    aria-label="Enable notifications"
                  />
                </label>

                {/* Channel toggles */}
                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Channels
                  </legend>
                  <div className="mt-2 space-y-2">
                    {CHANNELS.map((channel) => (
                      <label
                        key={channel}
                        className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                      >
                        <span className="text-sm text-slate-700 dark:text-slate-300">
                          {CHANNEL_LABELS[channel]}
                        </span>
                        <input
                          type="checkbox"
                          checked={channels.includes(channel)}
                          onChange={() => toggleChannel(channel)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          aria-label={`Channel ${CHANNEL_LABELS[channel]}`}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* Event type selection */}
                <fieldset>
                  <legend className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Event types
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {EVENT_OPTIONS.map((evt) => {
                      const selected = events.includes(evt);
                      return (
                        <button
                          key={evt}
                          type="button"
                          onClick={() => toggleEvent(evt)}
                          aria-pressed={selected}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            selected
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                              : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400',
                          )}
                        >
                          {EVENT_LABELS[evt] ?? evt}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                {/* Save + status */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save preferences'}
                  </button>
                  {saveState === 'saved' && (
                    <span
                      role="status"
                      className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"
                    >
                      <Check className="h-4 w-4" /> Saved
                    </span>
                  )}
                  {saveState === 'error' && (
                    <span role="alert" className="flex items-center gap-1 text-sm text-red-500">
                      <X className="h-4 w-4" /> {saveError ?? 'Failed to save'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Security</h2>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Wallet authentication and API key management
            </p>
            <button className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Manage Security Settings
            </button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Moon className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Appearance</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-slate-700 dark:text-slate-300">Dark Mode</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
              </label>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
