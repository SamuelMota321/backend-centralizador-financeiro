import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import type {
  Transaction,
  TransactionSnapshot,
} from '../../domain/transaction.js';
import type { CategoryRuleSnapshot } from '../../domain/category-rule.js';
import type {
  IdempotencyClaim,
  IdempotencyOperation,
  IdempotencyRecord,
  TenantIdempotencyRepository,
} from '../ports/idempotency.repository.port.js';
import type { TransactionAccountStateReader } from '../ports/transaction-account-state.port.js';
import type {
  TenantCategoriesRepository,
  TenantCategoryRulesRepository,
  TenantTransactionsRepository,
  TransactionPersistenceScope,
  TransactionsRepository,
} from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import {
  IdempotencyKeyExpired,
  IdempotencyKeyReused,
  IdempotencyRecordUnavailable,
  TransactionAccountArchived,
  TransactionAccountNotFound,
  TransferAccountsMustDiffer,
} from '../transactions.errors.js';
import { CreateAccountingTransfer } from './create-accounting-transfer.js';
import { CreateManualTransaction } from './create-manual-transaction.js';

describe('movement use cases', () => {
  it('uses the first active rule supplied in deterministic precedence order', async () => {
    const accountId = randomUUID();
    const preferredCategoryId = randomUUID();
    const fallbackCategoryId = randomUUID();
    const fixture = createFixture(
      [accountId],
      [
        {
          id: randomUUID(),
          tenantId: randomUUID(),
          categoryId: preferredCategoryId,
          conditionField: 'description',
          conditionOperator: 'contains',
          conditionValue: 'mercado',
          priority: 20,
          status: 'active',
          removedAt: null,
          createdAt: '2026-09-20T10:00:00.000Z',
          updatedAt: '2026-09-20T10:00:00.000Z',
        },
        {
          id: randomUUID(),
          tenantId: randomUUID(),
          categoryId: fallbackCategoryId,
          conditionField: 'description',
          conditionOperator: 'contains',
          conditionValue: 'mercado',
          priority: 10,
          status: 'active',
          removedAt: null,
          createdAt: '2026-09-20T10:00:01.000Z',
          updatedAt: '2026-09-20T10:00:01.000Z',
        },
      ],
    );
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    const result = await useCase.execute(fixture.context, 'rule-key', {
      accountId,
      type: 'expense',
      amount: '10.00',
      occurredOn: '2026-09-20',
      description: 'Mercado semanal',
    });

    expect(result).toMatchObject({
      categoryId: preferredCategoryId,
      categorizationStatus: 'categorized',
      categorizationSource: 'rule',
    });
  });

  it('creates an income and replays the same response without duplicating it', async () => {
    const accountId = randomUUID();
    const fixture = createFixture([accountId]);
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    const input = {
      accountId,
      type: 'income' as const,
      amount: '150.00',
      occurredOn: '2026-09-20',
      description: '  Salário   mensal ',
    };
    const first = await useCase.execute(fixture.context, 'income-key', input);
    const repeated = await useCase.execute(
      fixture.context,
      'income-key',
      input,
    );

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      accountId,
      type: 'income',
      amount: '150.00',
      description: 'Salário mensal',
      status: 'posted',
      categorizationStatus: 'unclassified',
    });
    expect(fixture.createdTransactions).toHaveLength(1);
  });

  it('rejects the same key when the normalized payload changes', async () => {
    const fixture = createFixture([randomUUID()]);
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );
    const input = {
      accountId: fixture.accountIds[0]!,
      type: 'expense' as const,
      amount: '10.00',
      occurredOn: '2026-09-20',
    };

    await useCase.execute(fixture.context, 'reused-key', input);
    await expect(
      useCase.execute(fixture.context, 'reused-key', {
        ...input,
        amount: '11.00',
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyReused);
    expect(fixture.createdTransactions).toHaveLength(1);
  });

  it('rejects a corrupted replay record for another tenant', async () => {
    const fixture = createFixture([randomUUID()]);
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );
    const input = {
      accountId: fixture.accountIds[0]!,
      type: 'income' as const,
      amount: '10.00',
      occurredOn: '2026-09-20',
    };
    await useCase.execute(fixture.context, 'corrupt-key', input);
    const key = 'transaction_create:corrupt-key';
    const record = fixture.records.get(key);
    if (!record) throw new Error('Expected idempotency fixture record.');
    fixture.records.set(key, { ...record, tenantId: randomUUID() });

    await expect(
      useCase.execute(fixture.context, 'corrupt-key', input),
    ).rejects.toBeInstanceOf(IdempotencyRecordUnavailable);
  });

  it('rejects a replay after the approved idempotency window', async () => {
    const fixture = createFixture([randomUUID()]);
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );
    const input = {
      accountId: fixture.accountIds[0]!,
      type: 'income' as const,
      amount: '10.00',
      occurredOn: '2026-09-20',
    };

    await useCase.execute(fixture.context, 'expired-key', input);
    const record = fixture.records.get('transaction_create:expired-key');
    if (!record) throw new Error('Expected idempotency fixture record.');
    fixture.records.set('transaction_create:expired-key', {
      ...record,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    await expect(
      useCase.execute(fixture.context, 'expired-key', input),
    ).rejects.toBeInstanceOf(IdempotencyKeyExpired);
  });

  it('denies missing and archived accounts before persistence', async () => {
    const missingId = randomUUID();
    const archivedId = randomUUID();
    const fixture = createFixture([archivedId]);
    fixture.accountStates.set(missingId, 'missing');
    fixture.accountStates.set(archivedId, 'archived');
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    await expect(
      useCase.execute(fixture.context, 'missing-key', {
        accountId: missingId,
        type: 'income',
        amount: '1.00',
        occurredOn: '2026-09-20',
      }),
    ).rejects.toBeInstanceOf(TransactionAccountNotFound);
    await expect(
      useCase.execute(fixture.context, 'archived-key', {
        accountId: archivedId,
        type: 'expense',
        amount: '1.00',
        occurredOn: '2026-09-20',
      }),
    ).rejects.toBeInstanceOf(TransactionAccountArchived);
    expect(fixture.createdTransactions).toHaveLength(0);
  });

  it('creates exactly two linked entries and replays an accounting transfer', async () => {
    const fixture = createFixture([randomUUID(), randomUUID()]);
    const useCase = new CreateAccountingTransfer(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );
    const input = {
      fromAccountId: fixture.accountIds[0]!,
      toAccountId: fixture.accountIds[1]!,
      amount: '25.40',
      occurredOn: '2026-09-20',
      description: 'Reserva',
    };

    const first = await useCase.execute(fixture.context, 'transfer-key', input);
    const repeated = await useCase.execute(
      fixture.context,
      'transfer-key',
      input,
    );

    expect(first).toEqual(repeated);
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({
      accountId: input.fromAccountId,
      type: 'transfer',
      transferSide: 'outgoing',
      categorizationStatus: 'not_applicable',
    });
    expect(typeof first.entries[0]?.transferId).toBe('string');
    expect(first.entries[1]).toMatchObject({
      accountId: input.toAccountId,
      type: 'transfer',
      transferSide: 'incoming',
      transferId: first.entries[0].transferId,
    });
    expect(fixture.createdTransactions).toHaveLength(2);
  });

  it('rejects transfers that use the same account on both sides', async () => {
    const accountId = randomUUID();
    const fixture = createFixture([accountId]);
    const useCase = new CreateAccountingTransfer(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    await expect(
      useCase.execute(fixture.context, 'same-account-key', {
        fromAccountId: accountId,
        toAccountId: accountId,
        amount: '1.00',
        occurredOn: '2026-09-20',
      }),
    ).rejects.toBeInstanceOf(TransferAccountsMustDiffer);
  });

  it('does not complete idempotency when the second transfer insert fails', async () => {
    const fixture = createFixture([randomUUID(), randomUUID()]);
    fixture.failOnCreateNumber = 2;
    const useCase = new CreateAccountingTransfer(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    await expect(
      useCase.execute(fixture.context, 'failed-transfer', {
        fromAccountId: fixture.accountIds[0]!,
        toAccountId: fixture.accountIds[1]!,
        amount: '25.40',
        occurredOn: '2026-09-20',
      }),
    ).rejects.toThrow('simulated persistence failure');
    expect(fixture.completeIdempotency).not.toHaveBeenCalled();
  });

  it('rolls back a created movement when its business audit cannot persist', async () => {
    const fixture = createFixture([randomUUID()]);
    fixture.failAudit = true;
    const useCase = new CreateManualTransaction(
      fixture.repository,
      fixture.unitOfWork,
      fixture.accountState,
    );

    await expect(
      useCase.execute(fixture.context, 'audit-failure', {
        accountId: fixture.accountIds[0]!,
        type: 'expense',
        amount: '10.00',
        occurredOn: '2026-09-20',
      }),
    ).rejects.toThrow('simulated audit persistence failure');
    expect(fixture.createdTransactions).toHaveLength(0);
    expect(fixture.records.has('transaction_create:audit-failure')).toBe(false);
  });
});

function createFixture(
  accountIds: readonly string[],
  activeRules: readonly CategoryRuleSnapshot[] = [],
) {
  const context: TenantContext = {
    tenantId: randomUUID(),
    userId: randomUUID(),
  };
  const accountStates = new Map<string, 'active' | 'archived' | 'missing'>(
    accountIds.map((accountId) => [accountId, 'active']),
  );
  const createdTransactions: TransactionSnapshot[] = [];
  let createCount = 0;
  let failOnCreateNumber: number | null = null;
  const records = new Map<string, IdempotencyRecord>();
  let failAudit = false;
  const completeIdempotency = vi.fn(
    (id: string, resourceIds: readonly string[]): Promise<void> => {
      const record = records.get(id);
      if (!record) throw new Error('Missing idempotency record.');
      const completed = {
        ...record,
        status: 'completed' as const,
        resourceIds,
      };
      for (const [key, value] of records.entries()) {
        if (value.id === id) records.set(key, completed);
      }
      return Promise.resolve();
    },
  );

  const transactions: TenantTransactionsRepository = {
    create: (transaction: Transaction) => {
      createCount += 1;
      if (failOnCreateNumber === createCount) {
        return Promise.reject(new Error('simulated persistence failure'));
      }
      const snapshot: TransactionSnapshot = {
        id: randomUUID(),
        tenantId: transaction.props.tenantId,
        accountId: transaction.props.accountId,
        type: transaction.props.type,
        amount: transaction.props.amount.toDecimal(),
        occurredOn: transaction.props.occurredOn,
        description: transaction.props.description,
        status: transaction.props.status,
        transferId: transaction.props.transferId,
        transferSide: transaction.props.transferSide,
        categoryId: transaction.props.categoryId,
        categorizationStatus: transaction.props.categorizationStatus,
        categorizationSource: transaction.props.categorizationSource,
        createdAt: '2026-09-20T10:00:00.000Z',
        updatedAt: '2026-09-20T10:00:00.000Z',
      };
      createdTransactions.push(snapshot);
      return Promise.resolve(snapshot);
    },
    findById: (transactionId: string) =>
      Promise.resolve(
        createdTransactions.find(({ id }) => id === transactionId) ?? null,
      ),
    findByIds: (transactionIds: readonly string[]) =>
      Promise.resolve(
        transactionIds.flatMap((transactionId) => {
          const snapshot = createdTransactions.find(
            ({ id }) => id === transactionId,
          );
          return snapshot ? [snapshot] : [];
        }),
      ),
    findByIdForUpdate: (transactionId: string) =>
      Promise.resolve(
        createdTransactions.find(({ id }) => id === transactionId) ?? null,
      ),
    count: () => Promise.resolve(createdTransactions.length),
    findPage: (offset: number, limit: number) =>
      Promise.resolve(createdTransactions.slice(offset, offset + limit)),
    update: (transaction: Transaction) =>
      Promise.resolve(
        createdTransactions.find(({ id }) => id === transaction.snapshot?.id) ??
          (transaction as never),
      ),
  };

  const idempotency: TenantIdempotencyRepository = {
    find: (operation: IdempotencyOperation, key: string) =>
      Promise.resolve(records.get(`${operation}:${key}`) ?? null),
    claim: (
      operation: IdempotencyOperation,
      key: string,
      payloadHash: string,
    ): Promise<IdempotencyClaim> => {
      const mapKey = `${operation}:${key}`;
      const existing = records.get(mapKey);
      if (existing)
        return Promise.resolve({ claimed: false, record: existing });
      const record: IdempotencyRecord = {
        id: randomUUID(),
        tenantId: context.tenantId,
        operation,
        key,
        payloadHash,
        status: 'pending',
        resourceIds: [],
        createdAt: '2026-09-20T10:00:00.000Z',
        expiresAt: '2099-09-21T10:00:00.000Z',
      };
      records.set(mapKey, record);
      records.set(record.id, record);
      return Promise.resolve({ claimed: true, record });
    },
    complete: completeIdempotency,
  };
  const scope: TransactionPersistenceScope = {
    transactions,
    categories: {} as TenantCategoriesRepository,
    categoryRules: {
      findActiveForEvaluation: () => Promise.resolve([...activeRules]),
    } as unknown as TenantCategoryRulesRepository,
    idempotency,
    audit: {
      write: () =>
        failAudit
          ? Promise.reject(new Error('simulated audit persistence failure'))
          : Promise.resolve(),
    } satisfies AuditWriter,
  };
  const repository: TransactionsRepository = {
    withTenant: <Result>(
      _context: TenantContext,
      operation: (value: TransactionPersistenceScope) => Promise<Result>,
    ) => operation(scope),
  };
  const unitOfWork: TransactionsUnitOfWork = {
    run: <Result>(
      _context: TenantContext,
      operation: (value: TransactionPersistenceScope) => Promise<Result>,
    ) => {
      const transactionCount = createdTransactions.length;
      const previousRecords = [...records.entries()];
      return operation(scope).catch((error: unknown) => {
        createdTransactions.splice(transactionCount);
        records.clear();
        for (const [key, value] of previousRecords) records.set(key, value);
        throw error;
      });
    },
  };
  const accountState: TransactionAccountStateReader = {
    getOwnedState: (_context, accountId) =>
      Promise.resolve(accountStates.get(accountId) ?? 'missing'),
  };

  return {
    context,
    accountIds,
    accountStates,
    repository,
    unitOfWork,
    accountState,
    createdTransactions,
    completeIdempotency,
    records,
    get failOnCreateNumber(): number | null {
      return failOnCreateNumber;
    },
    set failOnCreateNumber(value: number | null) {
      failOnCreateNumber = value;
    },
    set failAudit(value: boolean) {
      failAudit = value;
    },
  };
}
