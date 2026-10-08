import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  TenantTransactionsRepository,
  TransactionsRepository,
  TransactionPersistenceScope,
} from '../ports/transactions.repository.port.js';
import { createOfxExternalIdentityKey } from '../ofx-identity.js';
import { FindOfxTransactionDuplicates } from './find-ofx-transaction-duplicates.js';

const context: TenantContext = { tenantId: randomUUID(), userId: randomUUID() };
const accountId = randomUUID();

describe('FindOfxTransactionDuplicates', () => {
  it('uses account-scoped OFX identity and marks repeated rows within one file', async () => {
    const existingItem = {
      ordinal: 1,
      externalId: 'already-imported',
      type: 'expense' as const,
      amount: '10.00',
      occurredOn: '2026-10-01',
      description: 'Market',
      warnings: [],
    };
    const existingIdentityKey = createOfxExternalIdentityKey(existingItem);
    const findExistingExternalIdentityKeys = vi.fn(() =>
      Promise.resolve([existingIdentityKey]),
    );
    const transactions: TenantTransactionsRepository = {
      create: vi.fn(),
      createIfExternalIdentityAbsent: vi.fn(),
      findExistingExternalIdentityKeys,
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(),
      findByIds: vi.fn(),
      count: vi.fn(),
      findPage: vi.fn(),
      update: vi.fn(),
    };
    const scope = { transactions } as TransactionPersistenceScope;
    const repository: TransactionsRepository = {
      withTenant: (_context, operation) => operation(scope),
    };
    const items = [
      existingItem,
      { ...existingItem, ordinal: 2 },
      {
        ...existingItem,
        ordinal: 3,
        externalId: null,
        description: ' New   merchant ',
      },
      {
        ...existingItem,
        ordinal: 4,
        externalId: null,
        description: 'New merchant',
      },
    ];

    await expect(
      new FindOfxTransactionDuplicates(repository).execute(
        context,
        accountId,
        items,
      ),
    ).resolves.toEqual([true, true, false, true]);
    expect(findExistingExternalIdentityKeys).toHaveBeenCalledWith(
      accountId,
      expect.arrayContaining([existingIdentityKey]),
    );
  });
});
