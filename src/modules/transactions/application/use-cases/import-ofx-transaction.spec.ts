import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { Transaction } from '../../domain/transaction.js';
import type { TransactionPersistenceScope } from '../ports/transactions.repository.port.js';
import type { TransactionsUnitOfWork } from '../ports/transactions.unit-of-work.port.js';
import { ImportOfxTransaction } from './import-ofx-transaction.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const accountId = '264aa078-983d-4f3d-a28e-fb5575ddc3ee';

function line(externalId: string, overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    type: 'expense' as const,
    amount: '25.90',
    occurredOn: '2026-10-09',
    description: 'Despesa sintética',
    externalId,
    ...overrides,
  };
}

function build(options: {
  state?: 'active_local' | 'missing' | 'archived_local';
  duplicates?: string[];
}) {
  const runs = vi.fn();
  const getOwnedImportAvailability = vi.fn(() =>
    Promise.resolve(options.state ?? 'active_local'),
  );
  const audit = vi.fn(() => Promise.resolve());
  const scope = {
    transactions: {
      createIfExternalIdentityAbsent: vi.fn((transaction: Transaction) =>
        Promise.resolve(
          options.duplicates?.includes(transaction.props.description ?? '')
            ? null
            : ({ id: crypto.randomUUID() }),
        ),
      ),
    },
    audit: { write: audit },
  } as unknown as TransactionPersistenceScope;
  const unitOfWork: TransactionsUnitOfWork = {
    run: async (_context, operation) => {
      runs();
      return operation(scope);
    },
  };
  return {
    useCase: new ImportOfxTransaction(unitOfWork, { getOwnedImportAvailability }),
    runs,
    getOwnedImportAvailability,
    audit,
  };
}

describe('ImportOfxTransaction.executeMany', () => {
  it('checks the account once and writes the whole batch in one transaction', async () => {
    const { useCase, runs, getOwnedImportAvailability, audit } = build({});

    const outcomes = await useCase.executeMany(context, [
      line('a', { description: 'um' }),
      line('b', { description: 'dois' }),
      line('c', { description: 'três' }),
    ]);

    expect(outcomes.map((outcome) => outcome.disposition)).toEqual([
      'imported',
      'imported',
      'imported',
    ]);
    expect(getOwnedImportAvailability).toHaveBeenCalledOnce();
    expect(runs).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledTimes(3);
  });

  it('keeps the input order, reports duplicates and audits only what was created', async () => {
    const { useCase, audit } = build({ duplicates: ['dois'] });

    const outcomes = await useCase.executeMany(context, [
      line('a', { description: 'um' }),
      line('b', { description: 'dois' }),
    ]);

    expect(outcomes.map((outcome) => outcome.disposition)).toEqual(['imported', 'duplicate']);
    expect(audit).toHaveBeenCalledOnce();
  });

  it('fails every line when the account is missing or archived, without writing', async () => {
    const missing = build({ state: 'missing' });
    await expect(missing.useCase.executeMany(context, [line('a'), line('b')])).resolves.toEqual([
      { disposition: 'failed', errorCode: 'account_not_found' },
      { disposition: 'failed', errorCode: 'account_not_found' },
    ]);
    expect(missing.runs).not.toHaveBeenCalled();

    const archived = build({ state: 'archived_local' });
    await expect(archived.useCase.executeMany(context, [line('a')])).resolves.toEqual([
      { disposition: 'failed', errorCode: 'account_archived' },
    ]);
  });

  it('returns nothing for an empty batch and rejects a malformed account id', async () => {
    const { useCase, getOwnedImportAvailability } = build({});

    await expect(useCase.executeMany(context, [])).resolves.toEqual([]);
    await expect(
      useCase.executeMany(context, [line('a', { accountId: 'nao-e-uuid' })]),
    ).resolves.toEqual([{ disposition: 'failed', errorCode: 'invalid_request' }]);
    expect(getOwnedImportAvailability).not.toHaveBeenCalled();
  });
});
