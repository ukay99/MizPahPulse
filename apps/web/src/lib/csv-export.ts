/**
 * Client-side CSV export helpers (issue #15).
 *
 * `serializeEventsToCsv` is a pure function (escaping quotes/commas/newlines
 * per RFC 4180) so the formatting logic is unit-testable; `downloadCsv` is a
 * thin DOM wrapper around Blob + object URL for triggering the download.
 */

export interface CsvEventRow {
  eventType: string;
  category: string;
  account: string;
  amount?: string;
  timestamp: number | string;
}

/** Escape a single CSV field: quote when it contains a delimiter, quote, or newline. */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADERS = ['eventType', 'category', 'account', 'amount', 'timestamp'];

/** Format a row's timestamp as an ISO-8601 string. */
function toIsoTimestamp(value: number | string): string {
  if (typeof value === 'string') return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * Serialize events into CSV text with a header row. Fields containing
 * commas, quotes, or newlines are quoted and inner quotes doubled.
 */
export function serializeEventsToCsv(rows: CsvEventRow[]): string {
  const lines = [
    CSV_HEADERS.map(escapeCsvField).join(','),
    ...rows.map((row) =>
      [row.eventType, row.category, row.account, row.amount ?? '', toIsoTimestamp(row.timestamp)]
        .map(escapeCsvField)
        .join(','),
    ),
  ];
  return lines.join('\n');
}

/** Build a date-stamped filename, e.g. `mizpahpulse-events-2026-09-04.csv`. */
export function eventsCsvFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `mizpahpulse-events-${year}-${month}-${day}.csv`;
}

/** Trigger a browser download for the given CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Release the object URL on the next tick so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
