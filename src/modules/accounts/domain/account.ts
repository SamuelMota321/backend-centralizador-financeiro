import { parseAccountType, type AccountType } from './account-type.js';
import { BalanceReferenceDate } from './balance-reference-date.js';
import { Money } from './money.js';
import {
  normalizeAccountName,
  normalizeInstitution,
} from './text-normalization.js';

export type AccountOrigin = 'manual' | 'connected';
export type AccountExternalProvider = 'pluggy';

export type AccountProps = Readonly<{
  tenantId: string;
  name: string;
  type: AccountType;
  origin: AccountOrigin;
  institutionName: string | null;
  initialBalance: Money;
  initialBalanceAsOf: BalanceReferenceDate;
  currencyCode: 'BRL';
  externalProvider: AccountExternalProvider | null;
  externalAccountId: string | null;
}>;

export type CreateAccountProps = Readonly<{
  tenantId: string;
  name: string;
  type: string;
  institutionName?: string | null;
  initialBalance: string;
  initialBalanceAsOf: string;
}>;

export class Account {
  private constructor(readonly props: AccountProps) {}

  static createManual(input: CreateAccountProps, todayUtc?: string): Account {
    return new Account({
      tenantId: input.tenantId,
      name: normalizeAccountName(input.name),
      type: parseAccountType(input.type),
      origin: 'manual',
      institutionName: normalizeInstitution(input.institutionName),
      initialBalance: Money.fromDecimal(input.initialBalance),
      initialBalanceAsOf: BalanceReferenceDate.create(
        input.initialBalanceAsOf,
        todayUtc,
      ),
      currencyCode: 'BRL',
      externalProvider: null,
      externalAccountId: null,
    });
  }
}
