/**
 * Unit tests for the feed CSV export helpers (issue #15).
 *
 * Covers the header row, the required columns, quote/escape handling for
 * commas/quotes/newlines, filename date stamping, and the download wrapper.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  escapeCsvField,
  serializeEventsToCsv,
  eventsCsvFilename,
  downloadCsv,
} from '@/lib/csv-export';

describe('serializeEventsToCsv (#15)', () => {
  it('writes a header row plus one line per event with the required columns', () => {
    const csv = serializeEventsToCsv([
      {
        eventType: 'PAYMENT',
        category: 'PAYMENT',
        account: 'GABC...XYZ',
        amount: '125 XLM',
        timestamp: 1730000000000,
      },
    ]);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('eventType,category,account,amount,timestamp');
    expect(lines[1]).toContain('PAYMENT,PAYMENT,GABC...XYZ,125 XLM,');
    expect(lines[1]).toContain('2024-10-27T');
  });

  it('quotes and escapes fields containing commas, quotes, and newlines', () => {
    const csv = serializeEventsToCsv([
      {
        eventType: 'PAYMENT',
        category: 'PAYMENT',
        account: 'G1, 2, 3',
        amount: '"2,000" XLM',
        timestamp: '2026-09-04T10:00:00.000Z',
      },
    ]);

    expect(csv).toContain('"G1, 2, 3"');
    expect(csv).toContain('"""2,000"" XLM"');
    // Inner quotes are doubled inside the quoted field.
    expect(csv).toContain('""2,000""');
  });

  it('escapes newlines inside quoted fields', () => {
    const csv = serializeEventsToCsv([
      {
        eventType: 'PAYMENT',
        category: 'PAYMENT',
        account: 'line1\nline2',
        amount: undefined,
        timestamp: '2026-09-04T10:00:00.000Z',
      },
    ]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('treats missing amounts as empty and keeps timestamps as strings when given', () => {
    const csv = serializeEventsToCsv([
      {
        eventType: 'DEX_TRADE',
        category: 'DEX',
        account: 'GABC',
        timestamp: '2026-09-04T10:00:00.000Z',
      },
    ]);
    expect(csv).toContain('DEX_TRADE,DEX,GABC,,2026-09-04T10:00:00.000Z');
  });

  it('returns an empty header-only file for no rows', () => {
    expect(serializeEventsToCsv([])).toBe('eventType,category,account,amount,timestamp');
  });
});

describe('eventsCsvFilename (#15)', () => {
  it('includes the current date in the filename', () => {
    const name = eventsCsvFilename(new Date('2026-09-04T12:00:00.000Z'));
    expect(name).toBe('mizpahpulse-events-2026-09-04.csv');
  });
});

describe('escapeCsvField', () => {
  it('wraps null and undefined as empty strings', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('leaves plain values untouched', () => {
    expect(escapeCsvField('PAYMENT')).toBe('PAYMENT');
    expect(escapeCsvField(42)).toBe('42');
  });
});

describe('downloadCsv (#15)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates an object URL, clicks a download anchor, and revokes the URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const anchor = { href: '', download: '', click };
    vi.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLElement);
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => anchor as never);
    const removeSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation(() => anchor as never);

    downloadCsv('out.csv', 'a,b\n1,2');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchor.download).toBe('out.csv');
    expect(click).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    // URL revocation is deferred to the next tick.
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    vi.useRealTimers();
  });
});
