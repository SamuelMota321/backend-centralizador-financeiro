import { parseAccountType, type AccountType } from './account-type.js';
import { BalanceReferenceDate } from './balance-reference-date.js';
import { Money } from './money.js';
import {
  normalizeAccountName,
  normalizeInstitution,
} from './text-normalization.js';
import {
  AccountArchived,
  BalanceReferencePairRequired,
  ConnectedAccountReadOnly,
  InvalidAccountState,
} from './account.errors.js';

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

export type AccountSnapshot = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  type: AccountType;
  origin: AccountOrigin;
  institutionName: string | null;
  initialBalance: string;
  initialBalanceAsOf: string;
  currencyCode: 'BRL';
  externalProvider: AccountExternalProvider | null;
  externalAccountId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AccountUpdateProps = Readonly<{
  name?: string;
  type?: string;
  institutionName?: string | null;
  initialBalance?: string;
  initialBalanceAsOf?: string;
}>;

export class Account {
  private constructor(
    readonly props: AccountProps,
    readonly snapshot: AccountSnapshot | null = null,
  ) {}

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

  static reconstitute(input: AccountSnapshot): Account {
    if (
      (input.origin === 'manual' &&
        (input.externalProvider !== null ||
          input.externalAccountId !== null)) ||
      (input.origin === 'connected' &&
        (input.externalProvider === null || input.externalAccountId === null))
    ) {
      throw new InvalidAccountState(
        'Account origin and external identity disagree.',
      );
    }

    return new Account(
      {
        tenantId: input.tenantId,
        name: normalizeAccountName(input.name),
        type: parseAccountType(input.type),
        origin: input.origin,
        institutionName: normalizeInstitution(input.institutionName),
        initialBalance: Money.fromDecimal(input.initialBalance),
        initialBalanceAsOf: BalanceReferenceDate.create(
          input.initialBalanceAsOf,
        ),
        currencyCode: input.currencyCode,
        externalProvider: input.externalProvider,
        externalAccountId: input.externalAccountId,
      },
      input,
    );
  }

  update(input: AccountUpdateProps): Account {
    if (!this.snapshot || this.snapshot.archivedAt !== null) {
      throw new AccountArchived('Archived accounts cannot be updated.');
    }
    if (this.props.origin === 'connected') {
      throw new ConnectedAccountReadOnly(
        'Connected accounts cannot be updated by the maintenance API.',
      );
    }

    const hasBalance = input.initialBalance !== undefined;
    const hasBalanceDate = input.initialBalanceAsOf !== undefined;
    if (hasBalance !== hasBalanceDate) {
      throw new BalanceReferencePairRequired(
        'Initial balance and its reference date must be updated together.',
      );
    }

    const nextProps: AccountProps = {
      ...this.props,
      name:
        input.name === undefined
          ? this.props.name
          : normalizeAccountName(input.name),
      type:
        input.type === undefined
          ? this.props.type
          : parseAccountType(input.type),
      institutionName:
        input.institutionName === undefined
          ? this.props.institutionName
          : normalizeInstitution(input.institutionName),
      initialBalance:
        input.initialBalance === undefined
          ? this.props.initialBalance
          : Money.fromDecimal(input.initialBalance),
      initialBalanceAsOf:
        input.initialBalanceAsOf === undefined
          ? this.props.initialBalanceAsOf
          : BalanceReferenceDate.create(input.initialBalanceAsOf),
    };

    return new Account(nextProps, {
      ...this.snapshot,
      name: nextProps.name,
      type: nextProps.type,
      institutionName: nextProps.institutionName,
      initialBalance: nextProps.initialBalance.toDecimal(),
      initialBalanceAsOf: nextProps.initialBalanceAsOf.value,
    });
  }
}
