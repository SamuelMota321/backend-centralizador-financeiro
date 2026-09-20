import { InvalidTransactionAmount } from './transactions.errors.js';

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_CENTS = 9_999_999_999_999_999_999n;

export class TransactionAmount {
  private constructor(readonly amountInCents: bigint) {}

  static fromDecimal(value: string): TransactionAmount {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new InvalidTransactionAmount(
        'Transaction amount must be a canonical positive decimal with at most two fractional digits.',
      );
    }

    const [integer = '0', fraction = ''] = value.split('.');
    const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents <= 0n || cents > MAX_CENTS) {
      throw new InvalidTransactionAmount(
        'Transaction amount must be greater than zero and fit numeric(19,2).',
      );
    }
    return new TransactionAmount(cents);
  }

  toDecimal(): string {
    const integer = this.amountInCents / 100n;
    const fraction = (this.amountInCents % 100n).toString().padStart(2, '0');
    return `${integer}.${fraction}`;
  }
}
