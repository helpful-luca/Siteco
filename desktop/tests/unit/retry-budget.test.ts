import { describe, expect, it } from 'vitest';
import { RetryBudget } from '../../src/retry-budget';

describe('RetryBudget', () => {
  it('allows a fixed number of retries, then gives up', () => {
    const budget = new RetryBudget(3);
    expect(budget.fail()).toBe('retry');
    expect(budget.fail()).toBe('retry');
    expect(budget.fail()).toBe('give-up');
    expect(budget.fail()).toBe('give-up');
  });

  it('starts over after a success or a manual retry', () => {
    const budget = new RetryBudget(2);
    expect(budget.fail()).toBe('retry');
    budget.reset();
    expect(budget.fail()).toBe('retry');
    expect(budget.fail()).toBe('give-up');
  });
});
