import { InvalidBalanceReferenceDate } from './account.errors.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BalanceReferenceDate {
  private constructor(readonly value: string) {}

  static create(
    value: string,
    todayUtc = new Date().toISOString().slice(0, 10),
  ): BalanceReferenceDate {
    if (!DATE_PATTERN.test(value)) {
      throw new InvalidBalanceReferenceDate(
        'Balance reference date must use YYYY-MM-DD.',
      );
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value ||
      value > todayUtc
    ) {
      throw new InvalidBalanceReferenceDate(
        'Balance reference date must be a real, non-future UTC date.',
      );
    }
    return new BalanceReferenceDate(value);
  }
}
