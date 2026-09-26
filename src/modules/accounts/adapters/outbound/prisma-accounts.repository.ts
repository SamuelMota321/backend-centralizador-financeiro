import { Injectable } from '@nestjs/common';
import {
  AccountOrigin as PrismaAccountOrigin,
  AccountType as PrismaAccountType,
  Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  AccountView,
  DuplicateCandidate,
} from '../../application/account-view.js';
import type {
  AccountsRepository,
  TenantAccountsRepository,
} from '../../application/ports/accounts.repository.port.js';
import { AccountHasActiveCategoryRules } from '../../application/accounts.errors.js';
import type { Account, AccountSnapshot } from '../../domain/account.js';
import type { AccountType } from '../../domain/account-type.js';
import { AccountNotFound } from '../../domain/account.errors.js';

const accountSelect = {
  id: true,
  tenantId: true,
  name: true,
  type: true,
  origin: true,
  institutionName: true,
  initialBalance: true,
  initialBalanceAsOf: true,
  currencyCode: true,
  externalProvider: true,
  externalAccountId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AccountSelect;

type AccountRecord = Prisma.AccountGetPayload<{ select: typeof accountSelect }>;

const TO_PRISMA_TYPE: Record<AccountType, PrismaAccountType> = {
  checking: PrismaAccountType.CHECKING,
  savings: PrismaAccountType.SAVINGS,
  payment: PrismaAccountType.PAYMENT,
  cash: PrismaAccountType.CASH,
  credit_card: PrismaAccountType.CREDIT_CARD,
  investment: PrismaAccountType.INVESTMENT,
  other: PrismaAccountType.OTHER,
};

const FROM_PRISMA_TYPE: Record<PrismaAccountType, AccountType> = {
  CHECKING: 'checking',
  SAVINGS: 'savings',
  PAYMENT: 'payment',
  CASH: 'cash',
  CREDIT_CARD: 'credit_card',
  INVESTMENT: 'investment',
  OTHER: 'other',
};

export class PrismaTenantAccountsRepository implements TenantAccountsRepository {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly context: TenantContext,
  ) {}

  async findPossibleConnectedDuplicates(
    account: Account,
    excludedAccountId?: string,
  ): Promise<DuplicateCandidate[]> {
    const records = await this.transaction.account.findMany({
      where: {
        tenantId: this.context.tenantId,
        ...(excludedAccountId ? { id: { not: excludedAccountId } } : {}),
        archivedAt: null,
        origin: PrismaAccountOrigin.CONNECTED,
        name: account.props.name,
        type: TO_PRISMA_TYPE[account.props.type],
        institutionName: account.props.institutionName,
      },
      select: accountSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return records.map(toDuplicateCandidate);
  }

  async findByIdForUpdate(accountId: string): Promise<AccountSnapshot | null> {
    const locked = await this.transaction.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM public.accounts
      WHERE id = ${accountId}::uuid
        AND tenant_id = ${this.context.tenantId}::uuid
      FOR UPDATE
    `;
    if (!locked[0]) return null;

    const record = await this.transaction.account.findFirst({
      where: { id: accountId, tenantId: this.context.tenantId },
      select: accountSelect,
    });
    return record ? toAccountSnapshot(record) : null;
  }

  async update(accountId: string, account: Account): Promise<AccountView> {
    const result = await this.transaction.account.updateMany({
      where: { id: accountId, tenantId: this.context.tenantId },
      data: {
        name: account.props.name,
        type: TO_PRISMA_TYPE[account.props.type],
        institutionName: account.props.institutionName,
        initialBalance: account.props.initialBalance.toDecimal(),
        initialBalanceAsOf: new Date(
          `${account.props.initialBalanceAsOf.value}T00:00:00.000Z`,
        ),
      },
    });
    if (result.count !== 1) {
      throw new AccountNotFound('Account was not found.');
    }
    return this.findView(accountId);
  }

  async deactivate(accountId: string): Promise<AccountView> {
    try {
      await this.transaction.$executeRaw`
        UPDATE public.accounts
        SET archived_at = CURRENT_TIMESTAMP
        WHERE id = ${accountId}::uuid
          AND tenant_id = ${this.context.tenantId}::uuid
          AND archived_at IS NULL
      `;
    } catch (error: unknown) {
      if (
        hasNamedConstraint(
          error,
          'accounts_active_category_rules_archive_check',
        )
      ) {
        throw new AccountHasActiveCategoryRules();
      }
      throw error;
    }
    return this.findView(accountId);
  }

  private async findView(accountId: string): Promise<AccountView> {
    const record = await this.transaction.account.findFirst({
      where: { id: accountId, tenantId: this.context.tenantId },
      select: accountSelect,
    });
    if (!record) {
      throw new AccountNotFound('Account was not found.');
    }
    return toAccountView(record);
  }

  async createManual(account: Account): Promise<AccountView> {
    const record = await this.transaction.account.create({
      data: {
        tenantId: this.context.tenantId,
        name: account.props.name,
        type: TO_PRISMA_TYPE[account.props.type],
        origin: PrismaAccountOrigin.MANUAL,
        institutionName: account.props.institutionName,
        initialBalance: account.props.initialBalance.toDecimal(),
        initialBalanceAsOf: new Date(
          `${account.props.initialBalanceAsOf.value}T00:00:00.000Z`,
        ),
        currencyCode: account.props.currencyCode,
        externalProvider: null,
        externalAccountId: null,
      },
      select: accountSelect,
    });
    return toAccountView(record);
  }

  countActive(): Promise<number> {
    return this.transaction.account.count({
      where: { tenantId: this.context.tenantId, archivedAt: null },
    });
  }

  async findActive(offset: number, limit: number): Promise<AccountView[]> {
    const records = await this.transaction.account.findMany({
      where: { tenantId: this.context.tenantId, archivedAt: null },
      select: accountSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    });
    return records.map(toAccountView);
  }
}

function hasNamedConstraint(error: unknown, constraint: string): boolean {
  const visited = new Set<object>();

  function contains(value: unknown): boolean {
    if (typeof value === 'string') return value.includes(constraint);
    if (typeof value !== 'object' || value === null || visited.has(value)) {
      return false;
    }
    visited.add(value);
    const record = value as Record<string, unknown>;
    return (
      record.constraint === constraint ||
      contains(record.message) ||
      contains(record.meta) ||
      contains(record.cause) ||
      contains(record.driverAdapterError)
    );
  }

  return contains(error);
}

@Injectable()
export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  withTenant<Result>(
    context: TenantContext,
    operation: (repository: TenantAccountsRepository) => Promise<Result>,
  ): Promise<Result> {
    return this.tenantTransaction.run(context, (transaction) =>
      operation(new PrismaTenantAccountsRepository(transaction, context)),
    );
  }
}

function toAccountView(record: AccountRecord): AccountView {
  if (record.currencyCode !== 'BRL') {
    throw new Error('Unsupported account currency.');
  }
  return {
    id: record.id,
    name: record.name,
    type: FROM_PRISMA_TYPE[record.type],
    origin:
      record.origin === PrismaAccountOrigin.MANUAL ? 'manual' : 'connected',
    institutionName: record.institutionName,
    initialBalance: record.initialBalance.toFixed(2),
    initialBalanceAsOf: record.initialBalanceAsOf.toISOString().slice(0, 10),
    currencyCode: record.currencyCode,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toAccountSnapshot(record: AccountRecord): AccountSnapshot {
  if (record.currencyCode !== 'BRL') {
    throw new Error('Unsupported account currency.');
  }
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    type: FROM_PRISMA_TYPE[record.type],
    origin:
      record.origin === PrismaAccountOrigin.MANUAL ? 'manual' : 'connected',
    institutionName: record.institutionName,
    initialBalance: record.initialBalance.toFixed(2),
    initialBalanceAsOf: record.initialBalanceAsOf.toISOString().slice(0, 10),
    currencyCode: record.currencyCode,
    externalProvider:
      record.externalProvider === null
        ? null
        : (record.externalProvider.toLowerCase() as 'pluggy'),
    externalAccountId: record.externalAccountId,
    archivedAt: record.archivedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toDuplicateCandidate(record: AccountRecord): DuplicateCandidate {
  const view = toAccountView(record);
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    origin: view.origin,
    institutionName: view.institutionName,
  };
}
