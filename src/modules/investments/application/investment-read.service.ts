import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type {
  CollectionRecord,
  InvestmentReadRepository,
  PositionRecord,
} from './ports/investment-read.port.js';

export class InvestmentNotFound extends Error {
  override readonly name = 'InvestmentNotFound';
}

const FRESHNESS_MS = 96 * 60 * 60 * 1000;

export class InvestmentReadService {
  constructor(
    private readonly repository: InvestmentReadRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(context: TenantContext, page: number, pageSize: number) {
    // shortcut: totals read all authorized positions; move aggregation to SQL if portfolios become large.
    const collections = await this.repository.collections(context);
    const now = this.now();
    const positions = collections.flatMap((collection) =>
      collection.positions.map((position) =>
        toPosition(position, collection, now),
      ),
    );
    const coverage = collections.map((collection) => ({
      connectionId: collection.connectionId,
      availability: availability(collection),
    }));
    const portfolioAvailability =
      collections.length === 0
        ? 'unavailable'
        : coverage.every((item) => item.availability === 'complete')
          ? 'complete'
          : collections.some((item) => item.authorized && item.completeRunId)
            ? 'partial'
            : 'unavailable';
    const active = positions.filter(
      (position) => position.providerStatus === 'ACTIVE',
    );
    const canTotal =
      portfolioAvailability === 'complete' &&
      positions.every((position) =>
        ['ACTIVE', 'PENDING', 'TOTAL_WITHDRAWAL'].includes(
          position.providerStatus ?? '',
        ),
      ) &&
      active.length > 0 &&
      active.every(
        (position) =>
          position.currencyCode && position.dataQuality.freshness === 'current',
      );
    const sums = new Map<string, bigint>();
    if (canTotal) {
      for (const position of active) {
        const currency = position.currencyCode!;
        sums.set(
          currency,
          (sums.get(currency) ?? 0n) + cents(position.balance),
        );
      }
    }
    const totalsByCurrency = [...sums].map(([currencyCode, value]) => ({
      currencyCode,
      amount: money(value),
    }));
    const references = active
      .map((item) => item.referenceDate)
      .filter((date): date is string => Boolean(date));
    return {
      portfolio: {
        availability: portfolioAvailability,
        total: totalsByCurrency.length === 1 ? totalsByCurrency[0] : null,
        totalsByCurrency,
        referenceDate:
          canTotal && references.length === active.length
            ? references.sort()[0]
            : null,
        connections: coverage,
      },
      positions: positions.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: positions.length,
    };
  }

  async movements(
    context: TenantContext,
    positionId: string,
    page: number,
    pageSize: number,
  ) {
    const found = await this.repository.movements(context, positionId);
    if (!found) throw new InvestmentNotFound();
    const complete =
      availability(found.collection) === 'complete' &&
      found.collection.movementsComplete;
    const movements = complete ? found.movements : [];
    return {
      positionId,
      availability: complete ? 'complete' : 'unavailable',
      movements: movements
        .slice((page - 1) * pageSize, page * pageSize)
        .map((movement) => ({
          id: movement.id,
          source: 'pluggy',
          externalId: movement.externalId,
          type: movement.type,
          amount: movement.amount,
          currencyCode: null,
          occurredAt: movement.occurredAt.toISOString(),
          missingFields:
            movement.amount === null
              ? ['amount', 'currencyCode']
              : ['currencyCode'],
        })),
      page,
      pageSize,
      total: movements.length,
    };
  }
}

function availability(collection: CollectionRecord) {
  if (!collection.authorized || !collection.completeRunId) return 'unavailable';
  return collection.latestRunId === collection.completeRunId
    ? 'complete'
    : 'partial';
}

function toPosition(
  position: PositionRecord,
  collection: CollectionRecord,
  now: Date,
) {
  const collectionAvailability = availability(collection);
  const age = position.referenceDate
    ? now.getTime() - position.referenceDate.getTime()
    : null;
  const freshness =
    !position.lastSeenRunId || age === null || age < 0
      ? 'unknown'
      : collectionAvailability !== 'complete' || age > FRESHNESS_MS
        ? 'stale'
        : 'current';
  const view = {
    id: position.id,
    connectionId: position.connectionId,
    source: 'pluggy',
    externalId: position.externalId,
    name: position.name,
    assetType: position.assetType,
    subtype: position.subtype,
    providerStatus: position.providerStatus,
    currencyCode: position.currencyCode,
    balance: position.balance,
    quantity: position.quantity,
    investedAmount: position.investedAmount,
    resultAmount: position.resultAmount,
    institutionName: position.institutionName,
    referenceDate: position.referenceDate?.toISOString() ?? null,
    rate: position.rate,
    rateType: position.rateType,
    fixedAnnualRate: position.fixedAnnualRate,
    maturityDate: position.maturityDate?.toISOString().slice(0, 10) ?? null,
    dataQuality: { availability: collectionAvailability, freshness },
  };
  const optional = [
    'subtype',
    'providerStatus',
    'currencyCode',
    'quantity',
    'investedAmount',
    'resultAmount',
    'institutionName',
    'referenceDate',
    ...(position.assetType === 'FIXED_INCOME'
      ? ['rate', 'rateType', 'fixedAnnualRate', 'maturityDate']
      : []),
  ] as Array<keyof typeof view>;
  return {
    ...view,
    missingFields: optional.filter((field) => view[field] === null),
  };
}

function cents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Invalid stored investment balance');
  return BigInt(
    `${match[1] === '-' ? '-' : ''}${match[2]}${(match[3] ?? '').padEnd(2, '0')}`,
  );
}

function money(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
