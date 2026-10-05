import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src';

describe('CircuitBreaker', () => {
  it('opens at the threshold, half-opens after the cooldown, and closes on success', () => {
    let t = 0;
    const breaker = new CircuitBreaker(2, 100, () => t);
    expect(breaker.allow()).toBe(true);
    breaker.failure();
    expect(breaker.allow()).toBe(true);
    breaker.failure();
    expect(breaker.allow()).toBe(false);
    t = 100;
    expect(breaker.allow()).toBe(true);
    breaker.failure(); // the trial call failed: open again at once
    expect(breaker.allow()).toBe(false);
    t = 200;
    breaker.success();
    expect(breaker.allow()).toBe(true);
    expect(breaker.open).toBe(false);
  });
});
