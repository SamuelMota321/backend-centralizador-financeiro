import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import type { OfxSourceObjectStore } from '../ports/ofx-source-object-store.port.js';
import type { OfxTransactionImporter } from '../ports/ofx-transaction-importer.port.js';
import { ConfirmOfxImport } from './confirm-ofx-import.js';

const context: TenantContext = { tenantId: randomUUID(), userId: randomUUID() };
const importRunId = randomUUID();
const destinationAccountId = randomUUID();
const sourceObjectReference = `ofx/${context.tenantId}/${randomUUID()}.ofx`;

function details(status: 'processing' | 'completed', isDuplicate = false) {
  return {
    run: {
      id: importRunId,
      tenantId: context.tenantId,
      destinationAccountId,
      status,
      variant: 'ofx_1_sgml' as const,
      fileSizeBytes: 100,
      contentSha256: 'a'.repeat(64),
      sourceObjectReference,
      totalItems: 1,
      importedItems: status === 'completed' && !isDuplicate ? 1 : 0,
      ignoredItems: status === 'completed' && isDuplicate ? 1 : 0,
      failedItems: 0,
      terminalAt: status === 'completed' ? '2026-10-08T12:01:00.000Z' : null,
      retentionExpiresAt: status === 'completed' ? '2027-01-06T12:01:00.000Z' : null,
      createdAt: '2026-10-08T12:00:00.000Z',
      updatedAt: '2026-10-08T12:01:00.000Z',
    },
    items: [
      {
        ordinal: 1,
        externalId: 'fitid-1',
        type: 'expense' as const,
        amount: '10.00',
        occurredOn: '2026-10-01',
        description: 'Mercado',
        status: status === 'completed' ? (isDuplicate ? 'ignored_duplicate' as const : 'imported' as const) : 'previewed' as const,
        isDuplicate: status === 'completed' ? isDuplicate : null,
        warnings: [],
        errorCode: null,
      },
    ],
  };
}

describe('ConfirmOfxImport', () => {
  it('persists each new transaction through the importer and returns terminal counts', async () => {
    const processing = details('processing');
    const completed = details('completed');
    const saveItemResult = vi.fn(() => Promise.resolve());
    const deleteSource = vi.fn(() => Promise.resolve());
    const importTransaction = vi.fn(() =>
      Promise.resolve({
        disposition: 'imported' as const,
        transactionId: randomUUID(),
      }),
    );
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      startConfirmation: vi.fn(() => Promise.resolve(processing)),
      saveItemResult,
      finishRun: vi.fn(() => Promise.resolve(completed)),
      transitionRun: vi.fn(),
    };
    const importer: OfxTransactionImporter = {
      import: importTransaction,
    };
    const sourceObjectStore: OfxSourceObjectStore = {
      put: vi.fn(),
      delete: deleteSource,
    };

    const result = await new ConfirmOfxImport(
      repository,
      importer,
      sourceObjectStore,
    ).execute(context, importRunId, destinationAccountId, 'confirm-key');

    expect(result).toEqual(completed);
    expect(importTransaction).toHaveBeenCalledOnce();
    expect(saveItemResult).toHaveBeenCalledWith(
      context,
      importRunId,
      1,
      expect.objectContaining({ status: 'imported', isDuplicate: false }),
    );
    expect(deleteSource).toHaveBeenCalledWith(sourceObjectReference);
  });

  it('ignores duplicate transactions and does not import again on a completed replay', async () => {
    const processing = details('processing', true);
    const completed = details('completed', true);
    const startConfirmation = vi
      .fn<IngestionRepository['startConfirmation']>()
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed);
    const saveItemResult = vi.fn(() => Promise.resolve());
    const deleteSource = vi.fn(() => Promise.resolve());
    const importTransaction = vi.fn(() =>
      Promise.resolve({ disposition: 'duplicate' as const }),
    );
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      startConfirmation,
      saveItemResult,
      finishRun: vi.fn(() => Promise.resolve(completed)),
      transitionRun: vi.fn(),
    };
    const importer: OfxTransactionImporter = {
      import: importTransaction,
    };
    const sourceObjectStore: OfxSourceObjectStore = {
      put: vi.fn(),
      delete: deleteSource,
    };
    const useCase = new ConfirmOfxImport(repository, importer, sourceObjectStore);

    await useCase.execute(context, importRunId, destinationAccountId, 'confirm-key');
    await useCase.execute(context, importRunId, destinationAccountId, 'confirm-key');

    expect(importTransaction).toHaveBeenCalledOnce();
    expect(saveItemResult).toHaveBeenCalledWith(
      context,
      importRunId,
      1,
      expect.objectContaining({ status: 'ignored_duplicate', isDuplicate: true }),
    );
    expect(deleteSource).toHaveBeenCalledTimes(2);
  });
});
