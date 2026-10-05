/**
 * Stops calling PayPal for a while after it keeps failing, so a PayPal outage does not become a pile of
 * claimed actions with unknown outcomes. Closed: calls go through. After `threshold` failures in a row it
 * opens, and refuses for `cooldownMs`. Then one call is let through; its result closes or reopens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(threshold = 5, cooldownMs = 30_000, now: () => number = Date.now) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
  }

  allow(): boolean {
    return this.openedAt === undefined || this.now() - this.openedAt >= this.cooldownMs;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = undefined;
  }

  failure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold || this.openedAt !== undefined) {
      this.openedAt = this.now();
    }
  }

  get open(): boolean {
    return !this.allow();
  }
}
