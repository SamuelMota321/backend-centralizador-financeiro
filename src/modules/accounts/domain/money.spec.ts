import { describe, expect, it } from 'vitest';
import { InvalidMoney } from './account.errors.js';
import { Money } from './money.js';

describe('Money', () => {
  it.each([
    ['0', '0.00'],
    ['10.5', '10.50'],
    ['-1.25', '-1.25'],
    ['99999999999999999.99', '99999999999999999.99'],
    ['-99999999999999999.99', '-99999999999999999.99'],
  ])('parses %s exactly', (input, expected) => {
    expect(Money.fromDecimal(input).toDecimal()).toBe(expected);
  });

  it.each(['1.234', '01.00', '+1.00', '100000000000000000.00', 'NaN'])(
    'rejects invalid value %s',
    (input) => {
      expect(() => Money.fromDecimal(input)).toThrow(InvalidMoney);
    },
  );
});
