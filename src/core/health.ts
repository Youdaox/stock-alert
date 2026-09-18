/**
 * A source that quietly stops working looks exactly like a source with nothing in stock, so the
 * tracker watches its own sources and warns when one has not succeeded for a while.
 */
export interface SourceHealth {
  key: string;
  name: string;
  lastSuccessAt: Date | null;
  createdAt: Date;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface StaleSourceReport {
  key: string;
  name: string;
  /** Null when the source has never succeeded. */
  minutesSinceSuccess: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

const minutesBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / 60_000);

export function findStaleSources(
  sources: readonly SourceHealth[],
  now: Date,
  staleAfterMinutes: number,
): StaleSourceReport[] {
  const reports: StaleSourceReport[] = [];

  for (const source of sources) {
    const since = source.lastSuccessAt ?? source.createdAt;
    if (minutesBetween(since, now) < staleAfterMinutes) {
      continue;
    }

    reports.push({
      key: source.key,
      name: source.name,
      minutesSinceSuccess: source.lastSuccessAt ? minutesBetween(source.lastSuccessAt, now) : null,
      consecutiveFailures: source.consecutiveFailures,
      lastError: source.lastError,
    });
  }

  return reports;
}

export function formatStaleMessage(report: StaleSourceReport): { title: string; body: string } {
  const age =
    report.minutesSinceSuccess === null
      ? 'has never completed a check'
      : `last succeeded ${formatAge(report.minutesSinceSuccess)} ago`;

  const lines = [`${report.name} ${age}.`];
  if (report.consecutiveFailures > 0) {
    lines.push(`${report.consecutiveFailures} failed ${report.consecutiveFailures === 1 ? 'check' : 'checks'} in a row.`);
  }
  if (report.lastError) {
    lines.push(report.lastError.slice(0, 300));
  }

  return { title: `Stock check stalled: ${report.name}`, body: lines.join('\n') };
}

function formatAge(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
