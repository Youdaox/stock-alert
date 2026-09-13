export class InMemoryRateLimitedQueue<T> {
  private readonly items: T[] = [];
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly minIntervalMs: number,
    private readonly worker: (item: T) => Promise<void>,
  ) {}

  public enqueue(item: T): void {
    this.items.push(item);
    if (!this.timer) {
      this.start();
    }
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(async () => {
      const next = this.items.shift();
      if (!next) {
        return;
      }

      await this.worker(next);
    }, this.minIntervalMs);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }
}
