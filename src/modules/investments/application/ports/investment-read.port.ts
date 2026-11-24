import type { TenantContext } from '../../../../shared/application/tenant-context.js';

export type PositionRecord = Readonly<{
  id: string;
  connectionId: string;
  externalId: string;
  name: string;
  assetType: string;
  subtype: string | null;
  providerStatus: string | null;
  currencyCode: string | null;
  balance: string;
  quantity: string | null;
  investedAmount: string | null;
  resultAmount: string | null;
  institutionName: string | null;
  referenceDate: Date | null;
  rate: string | null;
  rateType: string | null;
  fixedAnnualRate: string | null;
  maturityDate: Date | null;
  lastSeenRunId: string | null;
}>;

export type CollectionRecord = Readonly<{
  connectionId: string;
  authorized: boolean;
  latestRunId: string | null;
  completeRunId: string | null;
  movementsComplete: boolean;
  positions: readonly PositionRecord[];
}>;

export type MovementRecord = Readonly<{
  id: string;
  externalId: string;
  type: string;
  amount: string | null;
  occurredAt: Date;
}>;

export interface InvestmentReadRepository {
  collections(context: TenantContext): Promise<readonly CollectionRecord[]>;
  movements(
    context: TenantContext,
    positionId: string,
  ): Promise<{
    collection: CollectionRecord;
    position: PositionRecord;
    movements: readonly MovementRecord[];
  } | null>;
}
