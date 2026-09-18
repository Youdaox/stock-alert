import { asc, eq, sql } from 'drizzle-orm';
import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';

import type { Adapter } from '../adapters/types.js';
import type { Db, Source } from '../db/client.js';
import { sources } from '../db/schema.js';
import type { HttpPolicy } from './http.js';
import { recordRun } from './record-run.js';

export interface PollerDeps {
  db: Db;
  logger: Logger;
  adapters: ReadonlyMap<string, Adapter>;
  http: HttpPolicy;
  channels: readonly string[];
  restockCooldownHours: number;
}

/** A failing source waits longer each time, so a blocked site is not hammered every cycle. */
const FAILURE_BACKOFF_BASE_SECONDS = 300;
const MAX_FAILURE_BACKOFF_STEPS = 8;

/** Sources are checked in parallel so a slow one cannot delay a fast-moving one. */
const SOURCE_CONCURRENCY = 3;

export interface CheckSchedule {
  config: unknown;
  lastRunAt: Date | null;
  consecutiveFailures: number;
}

const positive = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** How often a source wants to be checked, in seconds; minutes are still accepted. */
export function minIntervalSecondsOf(config: unknown): number {
  const { minIntervalSeconds, minIntervalMinutes } = (config ?? {}) as {
    minIntervalSeconds?: unknown;
    minIntervalMinutes?: unknown;
  };

  return positive(minIntervalSeconds) || positive(minIntervalMinutes) * 60;
}

export function isDueForCheck(source: CheckSchedule, now: Date): boolean {
  if (!source.lastRunAt) {
    return true;
  }

  const minIntervalSeconds = minIntervalSecondsOf(source.config);
  const failureSteps = Math.min(Math.max(source.consecutiveFailures, 0), MAX_FAILURE_BACKOFF_STEPS);
  const backoffSeconds =
    failureSteps > 0 ? Math.max(minIntervalSeconds, FAILURE_BACKOFF_BASE_SECONDS) * 2 ** (failureSteps - 1) : 0;

  const waitSeconds = Math.max(minIntervalSeconds, backoffSeconds);
  if (waitSeconds <= 0) {
    return true;
  }

  return now.getTime() >= source.lastRunAt.getTime() + waitSeconds * 1000;
}

const PARTIAL_RESULT_RATIO = 0.5;
// After this many rejected checks in a row, accept the smaller catalogue as real.
const PARTIAL_RESULT_ACCEPT_AFTER_FAILURES = 3;

function assertNotPartial(source: Source, productCount: number): void {
  const previous = source.lastProductCount;
  if (
    !previous ||
    productCount >= previous * PARTIAL_RESULT_RATIO ||
    source.consecutiveFailures >= PARTIAL_RESULT_ACCEPT_AFTER_FAILURES
  ) {
    return;
  }

  throw new Error(
    `Partial result guard: got ${productCount} products, expected about ${previous}; skipped saving this check`,
  );
}

export class Poller {
  private task: ScheduledTask | undefined;
  private cycle: Promise<void> | undefined;
  private readonly inFlight = new Set<number>();

  public constructor(private readonly deps: PollerDeps) {}

  public start(cronExpr: string): void {
    this.task = cron.schedule(cronExpr, () => {
      void this.runCycle();
    });
    void this.runCycle();
  }

  public runCycle(): Promise<void> {
    if (this.cycle) {
      this.deps.logger.warn('previous check cycle still running; skipping this one');
      return this.cycle;
    }

    this.cycle = this.pollEnabledSources().finally(() => {
      this.cycle = undefined;
    });
    return this.cycle;
  }

  public isChecking(sourceId: number): boolean {
    return this.inFlight.has(sourceId);
  }

  public async pollSource(source: Source, options: { force?: boolean } = {}): Promise<void> {
    const { db, logger } = this.deps;

    if (this.inFlight.has(source.id)) {
      logger.info({ source: source.key }, 'source is already being checked');
      return;
    }

    if (!options.force && !isDueForCheck(source, new Date())) {
      logger.debug({ source: source.key, consecutiveFailures: source.consecutiveFailures }, 'source not due yet');
      return;
    }

    const adapter = this.deps.adapters.get(source.adapterKey);
    if (!adapter) {
      logger.warn({ source: source.key, adapterKey: source.adapterKey }, 'adapter not registered');
      return;
    }

    this.inFlight.add(source.id);
    const started = Date.now();

    try {
      const result = await adapter.fetch(source.config, {
        http: this.deps.http,
        logger: logger.child({ source: source.key }),
      });
      assertNotPartial(source, result.products.length);

      const summary = await recordRun(db, source, result, {
        channels: this.deps.channels,
        restockCooldownHours: this.deps.restockCooldownHours,
      });
      logger.info({ source: source.key, ms: Date.now() - started, ...summary }, 'source checked');
    } catch (error) {
      logger.error({ err: error, source: source.key }, 'source check failed');
      const now = new Date();
      await db
        .update(sources)
        .set({
          lastRunAt: now,
          lastError: error instanceof Error ? error.message : String(error),
          consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
          updatedAt: now,
        })
        .where(eq(sources.id, source.id))
        .catch((dbError: unknown) => logger.error({ err: dbError }, 'failed to record source failure'));
    } finally {
      this.inFlight.delete(source.id);
    }
  }

  public async stop(): Promise<void> {
    await this.task?.stop();
    await this.cycle;
  }

  private async pollEnabledSources(): Promise<void> {
    try {
      const rows = await this.deps.db
        .select()
        .from(sources)
        .where(eq(sources.enabled, true))
        .orderBy(asc(sources.id));

      const queue = [...rows];
      const workers = Array.from({ length: Math.min(SOURCE_CONCURRENCY, queue.length) }, async () => {
        for (let source = queue.shift(); source; source = queue.shift()) {
          await this.pollSource(source);
        }
      });
      await Promise.all(workers);
    } catch (error) {
      this.deps.logger.error({ err: error }, 'check cycle failed');
    }
  }
}
