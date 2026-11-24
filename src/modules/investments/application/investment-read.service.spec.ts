import { describe, expect, it, vi } from 'vitest';
import {
  InvestmentReadService,
  InvestmentNotFound,
} from './investment-read.service.js';
import type {
  CollectionRecord,
  PositionRecord,
} from './ports/investment-read.port.js';

const context = { tenantId: 'tenant-one', userId: 'user-one' };
const now = new Date('2026-11-22T12:00:00.000Z');
const position: PositionRecord = {
  id: 'position-one',
  connectionId: 'connection-one',
  externalId: 'external-one',
  name: 'CDB sintético',
  assetType: 'FIXED_INCOME',
  subtype: 'CDB',
  providerStatus: 'ACTIVE',
  currencyCode: 'BRL',
  balance: '100.10',
  quantity: null,
  investedAmount: '90.00',
  resultAmount: null,
  institutionName: null,
  referenceDate: new Date('2026-11-21T12:00:00.000Z'),
  rate: '110',
  rateType: 'CDI',
  fixedAnnualRate: '10.5',
  maturityDate: null,
  lastSeenRunId: 'run-one',
};
const collection: CollectionRecord = {
  connectionId: 'connection-one',
  authorized: true,
  latestRunId: 'run-one',
  completeRunId: 'run-one',
  movementsComplete: true,
  positions: [position],
};

function service(collections: readonly CollectionRecord[]) {
  const repository = {
    collections: vi.fn(() => Promise.resolve(collections)),
    movements: vi.fn(() => Promise.resolve(null)),
  };
  return {
    read: new InvestmentReadService(repository, () => now),
    repository,
  };
}

describe('InvestmentReadService', () => {
  it('returns exact same-currency net totals and explicit optional fields', async () => {
    const pending = {
      ...position,
      id: 'position-pending',
      providerStatus: 'PENDING',
      balance: '20.00',
    };
    const second = { ...position, id: 'position-two', balance: '50.20' };
    const { read } = service([
      { ...collection, positions: [position, pending, second] },
    ]);
    const result = await read.list(context, 1, 2);
    expect(result.portfolio).toMatchObject({
      availability: 'complete',
      total: { amount: '150.30', currencyCode: 'BRL' },
    });
    expect(result.positions).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.positions[0]).toMatchObject({
      source: 'pluggy',
      externalId: 'external-one',
      assetType: 'FIXED_INCOME',
      investedAmount: '90.00',
      resultAmount: null,
      rate: '110',
      rateType: 'CDI',
      fixedAnnualRate: '10.5',
      dataQuality: { availability: 'complete', freshness: 'current' },
    });
    expect(result.positions[0]?.missingFields).toEqual(
      expect.arrayContaining([
        'quantity',
        'resultAmount',
        'institutionName',
        'maturityDate',
      ]),
    );
  });

  it('does not invent a cross-currency total', async () => {
    const usd = {
      ...position,
      id: 'position-usd',
      currencyCode: 'USD',
      balance: '2.25',
    };
    const { read } = service([{ ...collection, positions: [position, usd] }]);
    const result = await read.list(context, 1, 20);
    expect(result.portfolio.total).toBeNull();
    expect(result.portfolio.totalsByCurrency).toEqual([
      { currencyCode: 'BRL', amount: '100.10' },
      { currencyCode: 'USD', amount: '2.25' },
    ]);
  });

  it('marks retained data stale after a later incomplete run and omits totals', async () => {
    const { read } = service([{ ...collection, latestRunId: 'failed-run' }]);
    const result = await read.list(context, 1, 20);
    expect(result.portfolio).toMatchObject({
      availability: 'partial',
      total: null,
    });
    expect(result.positions[0]!.dataQuality).toEqual({
      availability: 'partial',
      freshness: 'stale',
    });
  });

  it('marks a complete position stale when its source date exceeds 96 hours', async () => {
    const old = {
      ...position,
      referenceDate: new Date('2026-11-17T11:59:59.000Z'),
    };
    const { read } = service([{ ...collection, positions: [old] }]);
    const result = await read.list(context, 1, 20);
    expect(result.positions[0]?.dataQuality).toEqual({
      availability: 'complete',
      freshness: 'stale',
    });
    expect(result.portfolio.total).toBeNull();
  });

  it('keeps legacy reference quality unknown and missing consent unavailable', async () => {
    const { read } = service([
      {
        ...collection,
        latestRunId: null,
        completeRunId: null,
        positions: [{ ...position, lastSeenRunId: null, referenceDate: null }],
      },
      {
        ...collection,
        connectionId: 'connection-two',
        authorized: false,
        positions: [],
      },
    ]);
    const result = await read.list(context, 1, 20);
    expect(result.portfolio).toMatchObject({
      availability: 'unavailable',
      total: null,
    });
    expect(result.positions[0]!.dataQuality.freshness).toBe('unknown');
    expect(result.positions[0]!.missingFields).toContain('referenceDate');
  });

  it('returns only completed movements and keeps their missing currency explicit', async () => {
    const { read, repository } = service([collection]);
    repository.movements.mockResolvedValueOnce({
      collection,
      position,
      movements: [
        {
          id: 'movement-one',
          externalId: 'external-movement',
          type: 'BUY',
          amount: null,
          occurredAt: now,
        },
      ],
    } as never);
    expect(await read.movements(context, position.id, 1, 20)).toMatchObject({
      availability: 'complete',
      movements: [
        {
          source: 'pluggy',
          amount: null,
          currencyCode: null,
          missingFields: ['amount', 'currencyCode'],
        },
      ],
    });
    await expect(
      read.movements(context, 'other-tenant-position', 1, 20),
    ).rejects.toBeInstanceOf(InvestmentNotFound);
    expect(repository.movements).toHaveBeenCalledWith(
      context,
      'other-tenant-position',
    );
  });

  it('does not return movements from an incomplete collection', async () => {
    const incomplete = { ...collection, movementsComplete: false };
    const { read, repository } = service([incomplete]);
    repository.movements.mockResolvedValueOnce({
      collection: incomplete,
      position,
      movements: [
        {
          id: 'old',
          externalId: 'old',
          type: 'BUY',
          amount: '1.00',
          occurredAt: now,
        },
      ],
    } as never);
    expect(await read.movements(context, position.id, 1, 20)).toMatchObject({
      availability: 'unavailable',
      movements: [],
      total: 0,
    });
  });
});
