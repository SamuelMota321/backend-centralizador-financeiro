export type OfxVariant = 'ofx_1_sgml' | 'ofx_2_xml';
export type OfxTransactionType = 'income' | 'expense';
export type OfxIngestionWarning = 'external_id_missing';

export type ParsedOfxTransaction = Readonly<{
  ordinal: number;
  externalId: string | null;
  type: OfxTransactionType;
  amount: string;
  occurredOn: string;
  description: string | null;
  warnings: readonly OfxIngestionWarning[];
}>;

export type ParsedOfxStatement = Readonly<{
  variant: OfxVariant;
  transactions: readonly ParsedOfxTransaction[];
}>;
