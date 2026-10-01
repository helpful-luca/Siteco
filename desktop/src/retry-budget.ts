/** Counts failures in a row; after `max` of them the caller stops retrying on its own. */
export class RetryBudget {
  private failures = 0;

  constructor(private readonly max: number) {}

  fail(): 'retry' | 'give-up' {
    this.failures += 1;
    return this.failures < this.max ? 'retry' : 'give-up';
  }

  reset(): void {
    this.failures = 0;
  }
}
