import { InvalidMoney } from './account.errors.js';

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const MAX_CENTS = 9_999_999_999_999_999_999n;

export class Money {
  private constructor(
    readonly amountInCents: bigint,
    readonly currency: 'BRL',
  ) {}

  static fromDecimal(value: string): Money {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new InvalidMoney(
        'Money must be a canonical decimal string with at most two fractional digits.',
      );
    }

    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [integer = '0', fraction = ''] = unsigned.split('.');
    const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
    const signedCents = negative && cents !== 0n ? -cents : cents;

    if (signedCents < -MAX_CENTS || signedCents > MAX_CENTS) {
      throw new InvalidMoney('Money exceeds numeric(19,2).');
    }
    return new Money(signedCents, 'BRL');
  }

  toDecimal(): string {
    const negative = this.amountInCents < 0n;
    const absolute = negative ? -this.amountInCents : this.amountInCents;
    const integer = absolute / 100n;
    const fraction = (absolute % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${integer}.${fraction}`;
  }
}
