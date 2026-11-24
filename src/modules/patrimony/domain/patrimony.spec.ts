import { describe, expect, it } from 'vitest';
import { InvalidPatrimony, normalizePatrimony } from './patrimony.js';

describe('manual patrimony rules', () => {
  it('normalizes valid assets and accepts zero outstanding balance', () => {
    expect(
      normalizePatrimony('asset', {
        type: ' Vehicle ',
        description: ' Car ',
        estimatedValue: '1200.5',
        valuationDate: '2026-11-01',
        source: ' Owner ',
      }),
    ).toEqual({
      type: 'Vehicle',
      description: 'Car',
      estimatedValue: '1200.50',
      valuationDate: '2026-11-01',
      source: 'Owner',
    });
    expect(
      normalizePatrimony('liability', {
        description: 'Loan',
        outstandingBalance: '0',
      }).outstandingBalance,
    ).toBe('0.00');
  });

  it('rejects invalid dates, amounts, empty text, and association IDs', () => {
    expect(() =>
      normalizePatrimony('asset', {
        type: 'House',
        description: 'Home',
        estimatedValue: '1',
        valuationDate: '2026-02-30',
        source: 'Owner',
      }),
    ).toThrow(InvalidPatrimony);
    expect(() =>
      normalizePatrimony('asset', {
        type: ' ',
        description: 'Home',
        estimatedValue: '1',
        valuationDate: '2026-11-01',
        source: 'Owner',
      }),
    ).toThrow(InvalidPatrimony);
    expect(() =>
      normalizePatrimony('liability', {
        description: 'Loan',
        outstandingBalance: '-1',
      }),
    ).toThrow(InvalidPatrimony);
    expect(() =>
      normalizePatrimony('financing', {
        description: 'Loan',
        outstandingBalance: '1',
        assetId: 'foreign',
      }),
    ).toThrow(InvalidPatrimony);
  });
});
