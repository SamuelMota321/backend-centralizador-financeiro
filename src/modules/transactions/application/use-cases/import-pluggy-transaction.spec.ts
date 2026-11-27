import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import type { Transaction } from '../../domain/transaction.js';
import type { TransactionAccountImportEligibilityReader } from '../ports/transaction-account-import-eligibility.port.js';
import type { TransactionPersistenceScope } from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import { ImportPluggyTransaction } from './import-pluggy-transaction.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};

describe('ImportPluggyTransaction', () => {
  it('uses a stable external identity and does not audit a duplicate', async () => {
    const createdTransactions: Transaction[] = [];
    const createIfExternalIdentityAbsent = vi.fn((transaction: Transaction) => {
      createdTransactions.push(transaction);
      return Promise.resolve(null);
    });
    const auditWrite = vi.fn(() => Promise.resolve());
    const scope = {
      transactions: { createIfExternalIdentityAbsent },
      audit: { write: auditWrite } satisfies AuditWriter,
      categoryRules: { findActiveForEvaluation: () => Promise.resolve([]) },
    } as unknown as TransactionPersistenceScope;
    const unitOfWork: TransactionsUnitOfWork = {
      run: async (_context, operation) => operation(scope),
    };
    const accountState: TransactionAccountImportEligibilityReader = {
      getOwnedImportAvailability: () => Promise.resolve('active_connected'),
    };
    const useCase = new ImportPluggyTransaction(unitOfWork, accountState);
    const input = {
      connectionId: '164aa078-983d-4f3d-a28e-fb5575ddc3ee',
      accountId: '264aa078-983d-4f3d-a28e-fb5575ddc3ee',
      providerAccountId: '364aa078-983d-4f3d-a28e-fb5575ddc3ee',
      providerTransactionId: '464aa078-983d-4f3d-a28e-fb5575ddc3ee',
      currencyCode: 'BRL',
      type: 'expense' as const,
      amount: '25.90',
      occurredOn: '2026-10-09',
      description: 'Despesa sintética',
    };

    await expect(useCase.execute(context, input)).resolves.toEqual({
      disposition: 'duplicate',
    });
    await expect(useCase.execute(context, input)).resolves.toEqual({
      disposition: 'duplicate',
    });

    expect(createdTransactions).toHaveLength(2);
    expect(createdTransactions[0]?.props.externalIdentityKey).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(createdTransactions[1]?.props.externalIdentityKey).toBe(
      createdTransactions[0]?.props.externalIdentityKey,
    );
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'duplicate', 1],
    [1, 'duplicate', 0],
    [2, 'ambiguous', 0],
  ] as const)(
    'handles missing Pluggy IDs with %i matching local transactions',
    async (matches, disposition, createCalls) => {
      const countFallbackCandidates = vi.fn(() => Promise.resolve(matches));
      const createIfExternalIdentityAbsent = vi.fn(() => Promise.resolve(null));
      const scope = {
        transactions: {
          countFallbackCandidates,
          createIfExternalIdentityAbsent,
        },
        audit: { write: vi.fn(() => Promise.resolve()) },
        categoryRules: { findActiveForEvaluation: () => Promise.resolve([]) },
      } as unknown as TransactionPersistenceScope;
      const useCase = new ImportPluggyTransaction(
        { run: async (_context, operation) => operation(scope) },
        {
          getOwnedImportAvailability: () => Promise.resolve('active_connected'),
        },
      );
      const input = {
        connectionId: '164aa078-983d-4f3d-a28e-fb5575ddc3ee',
        accountId: '264aa078-983d-4f3d-a28e-fb5575ddc3ee',
        providerAccountId: '364aa078-983d-4f3d-a28e-fb5575ddc3ee',
        providerTransactionId: null,
        currencyCode: 'BRL',
        type: 'expense' as const,
        amount: '25.90',
        occurredOn: '2026-10-09',
        description: 'Despesa sintética',
      };
      await expect(useCase.execute(context, input)).resolves.toEqual({
        disposition,
      });
      expect(countFallbackCandidates).toHaveBeenCalledWith({
        accountId: input.accountId,
        type: input.type,
        amount: '25.9',
        occurredOn: input.occurredOn,
        description: input.description,
      });
      expect(createIfExternalIdentityAbsent).toHaveBeenCalledTimes(createCalls);
    },
  );
});
