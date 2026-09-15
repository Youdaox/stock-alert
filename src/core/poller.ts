import cron, { type ScheduledTask } from 'node-cron';
import type { Logger } from 'pino';

import type { Adapter, Snapshot, SourceConfig } from '../adapters/types.js';

export interface PollerDeps {
  logger: Logger;
  adapters: ReadonlyMap<string, Adapter>;
  sources: () => Promise<SourceConfig[]>;
  writeSnapshots: (source: SourceConfig, snapshots: Snapshot[]) => Promise<void>;
}

export class Poller {
  private readonly previousCounts = new Map<number, number>();
  private task?: ScheduledTask;

  public constructor(private readonly deps: PollerDeps) {}

  public start(cronExpr: string): void {
    this.task = cron.schedule(cronExpr, async () => {
      await this.runCycle();
    });
  }

  public async runCycle(): Promise<void> {
    const sources = await this.deps.sources();

    for (const source of sources) {
      if (!source.enabled) {
        continue;
      }

      const adapter = this.deps.adapters.get(source.adapterKey);
      if (!adapter) {
        this.deps.logger.warn({ adapterKey: source.adapterKey }, 'adapter not registered');
        continue;
      }

      const snapshots = await adapter.fetch(source.config);
      const previousCount = this.previousCounts.get(source.id) ?? snapshots.length;

      if (previousCount > 0 && snapshots.length < previousCount * 0.5) {
        this.deps.logger.warn(
          { sourceId: source.id, previousCount, currentCount: snapshots.length },
          'partial failure guard triggered; skipping writes for this cycle',
        );
        continue;
      }

      await this.deps.writeSnapshots(source, snapshots);
      this.previousCounts.set(source.id, snapshots.length);
    }
  }

  public async stop(): Promise<void> {
    await this.task?.stop();
  }
}
