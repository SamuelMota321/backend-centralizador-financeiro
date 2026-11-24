import { Money } from '../../accounts/domain/money.js';

export type PatrimonyKind = 'asset' | 'financing' | 'liability';
export type AssetData = Readonly<{
  type: string;
  description: string;
  estimatedValue: string;
  valuationDate: string;
  source: string;
}>;
export type DebtData = Readonly<{
  description: string;
  outstandingBalance: string;
}>;
export type FinancingData = DebtData & Readonly<{ assetId: string | null }>;
export type PatrimonyData = AssetData | FinancingData | DebtData;

export class InvalidPatrimony extends Error {
  override readonly name = 'InvalidPatrimony';
}

export function normalizePatrimony(kind: 'asset', input: AssetData): AssetData;
export function normalizePatrimony(
  kind: 'financing',
  input: FinancingData,
): FinancingData;
export function normalizePatrimony(
  kind: 'liability',
  input: DebtData,
): DebtData;
export function normalizePatrimony(
  kind: PatrimonyKind,
  input: PatrimonyData,
): PatrimonyData;
export function normalizePatrimony(
  kind: PatrimonyKind,
  input: PatrimonyData,
): PatrimonyData {
  const description = boundedText(input.description, 500, 'description');
  if (kind === 'asset') {
    const asset = input as AssetData;
    const valuationDate = asset.valuationDate;
    const parsed = new Date(`${valuationDate}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(valuationDate) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== valuationDate
    ) {
      throw new InvalidPatrimony('Invalid valuationDate.');
    }
    return {
      type: boundedText(asset.type, 80, 'type'),
      description,
      estimatedValue: nonnegativeMoney(asset.estimatedValue),
      valuationDate,
      source: boundedText(asset.source, 120, 'source'),
    };
  }
  const debt = input as DebtData;
  const normalized = {
    description,
    outstandingBalance: nonnegativeMoney(debt.outstandingBalance),
  };
  if (kind === 'liability') return normalized;
  const assetId = (input as FinancingData).assetId;
  if (assetId !== null && !isUuid(assetId)) {
    throw new InvalidPatrimony('Invalid assetId.');
  }
  return { ...normalized, assetId };
}

function boundedText(value: string, max: number, field: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > max ||
    Array.from(trimmed).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new InvalidPatrimony(`Invalid ${field}.`);
  }
  return trimmed;
}

function nonnegativeMoney(value: string): string {
  try {
    const money = Money.fromDecimal(value);
    if (money.amountInCents < 0n)
      throw new InvalidPatrimony('Amount must be nonnegative.');
    return money.toDecimal();
  } catch {
    throw new InvalidPatrimony('Invalid nonnegative money amount.');
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
