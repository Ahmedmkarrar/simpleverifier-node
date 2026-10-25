export type Sleep = (ms: number) => Promise<void>;
export type Clock = () => number;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sliding-window limiter: at most `limit` acquisitions in any `windowMs` span.
 * Callers queue in order, so a burst is spread out rather than rejected.
 */
export class RateLimiter {
  private readonly stamps: number[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: Clock = Date.now,
    private readonly sleep: Sleep = defaultSleep,
  ) {}

  acquire(): Promise<void> {
    if (this.limit <= 0) return Promise.resolve();
    const turn = this.tail.then(() => this.waitForSlot());
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.stamps.length > 0 && now - (this.stamps[0] ?? 0) >= this.windowMs) this.stamps.shift();
      if (this.stamps.length < this.limit) {
        this.stamps.push(now);
        return;
      }
      await this.sleep(this.windowMs - (now - (this.stamps[0] ?? now)));
    }
  }
}
