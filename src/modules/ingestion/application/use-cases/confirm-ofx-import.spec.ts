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
    const saveItemResults = vi.fn(() => Promise.resolve());
    const deleteSource = vi.fn(() => Promise.resolve());
    const importTransaction = vi.fn(() =>
      Promise.resolve([
        {
          disposition: 'imported' as const,
          transactionId: randomUUID(),
        },
      ]),
    );
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      startConfirmation: vi.fn(() => Promise.resolve(processing)),
      saveItemResults,
      finishRun: vi.fn(() => Promise.resolve(completed)),
      transitionRun: vi.fn(),
    };
    const importer: OfxTransactionImporter = {
      importMany: importTransaction,
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
    expect(saveItemResults).toHaveBeenCalledWith(context, importRunId, [
      expect.objectContaining({ ordinal: 1, status: 'imported', isDuplicate: false }),
    ]);
    expect(deleteSource).toHaveBeenCalledWith(sourceObjectReference);
  });

  it('ignores duplicate transactions and does not import again on a completed replay', async () => {
    const processing = details('processing', true);
    const completed = details('completed', true);
    const startConfirmation = vi
      .fn<IngestionRepository['startConfirmation']>()
      .mockResolvedValueOnce(processing)
      .mockResolvedValueOnce(completed);
    const saveItemResults = vi.fn(() => Promise.resolve());
    const deleteSource = vi.fn(() => Promise.resolve());
    const importTransaction = vi.fn(() =>
      Promise.resolve([{ disposition: 'duplicate' as const }]),
    );
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      startConfirmation,
      saveItemResults,
      finishRun: vi.fn(() => Promise.resolve(completed)),
      transitionRun: vi.fn(),
    };
    const importer: OfxTransactionImporter = {
      importMany: importTransaction,
    };
    const sourceObjectStore: OfxSourceObjectStore = {
      put: vi.fn(),
      delete: deleteSource,
    };
    const useCase = new ConfirmOfxImport(repository, importer, sourceObjectStore);

    await useCase.execute(context, importRunId, destinationAccountId, 'confirm-key');
    await useCase.execute(context, importRunId, destinationAccountId, 'confirm-key');

    expect(importTransaction).toHaveBeenCalledOnce();
    expect(saveItemResults).toHaveBeenCalledWith(context, importRunId, [
      expect.objectContaining({ ordinal: 1, status: 'ignored_duplicate', isDuplicate: true }),
    ]);
    expect(deleteSource).toHaveBeenCalledTimes(2);
  });

  it('processes fourteen lines in batches and records a failure without stopping the rest', async () => {
    const base = details('processing');
    const template = base.items[0]!;
    const items = Array.from({ length: 14 }, (_, index) => ({
      ...template,
      ordinal: index + 1,
      externalId: `fitid-${index + 1}`,
    }));
    const processing = { ...base, run: { ...base.run, totalItems: items.length }, items };
    const completed = details('completed');
    const saveItemResults = vi.fn<IngestionRepository['saveItemResults']>(() => Promise.resolve());
    const importMany = vi.fn<OfxTransactionImporter['importMany']>((_context, inputs) =>
      Promise.resolve(
        inputs.map((input) =>
          input.externalId === 'fitid-1'
            ? { disposition: 'failed' as const, errorCode: 'invalid_request' as const }
            : { disposition: 'imported' as const, transactionId: randomUUID() },
        ),
      ),
    );
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      startConfirmation: vi.fn(() => Promise.resolve(processing)),
      saveItemResults,
      finishRun: vi.fn(() => Promise.resolve(completed)),
      transitionRun: vi.fn(),
    };
    const sourceObjectStore: OfxSourceObjectStore = {
      put: vi.fn(),
      delete: vi.fn(() => Promise.resolve()),
    };

    await new ConfirmOfxImport(repository, { importMany }, sourceObjectStore).execute(
      context,
      importRunId,
      destinationAccountId,
      'confirm-key',
    );

    expect(importMany.mock.calls.map(([, inputs]) => inputs.length)).toEqual([5, 5, 4]);
    const savedBatches = saveItemResults.mock.calls.map(([, , batch]) => batch);
    expect(savedBatches.map((batch) => batch.length)).toEqual([5, 5, 4]);
    const savedItems = savedBatches.flat();
    expect(savedItems.map((item) => item.ordinal)).toEqual(items.map((item) => item.ordinal));
    expect(savedItems[0]).toMatchObject({ ordinal: 1, status: 'failed', errorCode: 'invalid_request' });
    expect(savedItems.slice(1).every((item) => item.status === 'imported')).toBe(true);
  });
});
