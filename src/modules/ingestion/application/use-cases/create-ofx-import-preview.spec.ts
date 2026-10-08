import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { ImportRunSnapshot } from '../../domain/import-run.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import type { OfxAccountOwnership } from '../ports/ofx-account-ownership.port.js';
import type { OfxSourceObjectStore } from '../ports/ofx-source-object-store.port.js';
import type { FindOfxTransactionDuplicates } from '../../../transactions/application/use-cases/find-ofx-transaction-duplicates.js';
import { OfxJsParserAdapter } from '../../adapters/outbound/ofx-js-parser.adapter.js';
import { CreateOfxImportPreview } from './create-ofx-import-preview.js';

const context: TenantContext = { tenantId: randomUUID(), userId: randomUUID() };
const destinationAccountId = randomUUID();
const bankFixture = readFileSync(
  new URL(
    '../../../../../test/fixtures/ofx/ofx-1-bank-ascii.ofx',
    import.meta.url,
  ),
);

function createUseCase() {
  const sourceObjectReference = `ofx/${context.tenantId}/${randomUUID()}.ofx`;
  const run: ImportRunSnapshot = {
    id: randomUUID(),
    tenantId: context.tenantId,
    destinationAccountId,
    status: 'preview_ready',
    variant: 'ofx_1_sgml',
    fileSizeBytes: bankFixture.byteLength,
    contentSha256: createHash('sha256').update(bankFixture).digest('hex'),
    sourceObjectReference,
    totalItems: 1,
    importedItems: 0,
    ignoredItems: 0,
    failedItems: 0,
    terminalAt: null,
    retentionExpiresAt: null,
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
  };
  const details = {
    run,
    items: [
      {
        ordinal: 1,
        externalId: 'synthetic-001',
        type: 'expense' as const,
        amount: '25.90',
        occurredOn: '2026-09-30',
        description: 'Mercado',
        status: 'previewed' as const,
        isDuplicate: false,
        warnings: [],
        errorCode: null,
      },
    ],
  };
  const createPreview = vi
    .fn<IngestionRepository['createPreview']>()
    .mockResolvedValue({ created: true, details });
  const putSource = vi.fn(() => Promise.resolve());
  const deleteSource = vi.fn(() => Promise.resolve());
  const repository: IngestionRepository = {
    createPreview,
    findRun: vi.fn(),
    startConfirmation: vi.fn(),
    saveItemResult: vi.fn(),
    finishRun: vi.fn(),
    transitionRun: vi.fn(),
  };
  const accountOwnership: OfxAccountOwnership = {
    getOwnedState: vi.fn(() => Promise.resolve('active_local' as const)),
  };
  const findDuplicates = {
    execute: vi.fn(() => Promise.resolve([false])),
  } as unknown as FindOfxTransactionDuplicates;
  const sourceObjectStore: OfxSourceObjectStore = {
    put: putSource,
    delete: deleteSource,
  };
  const useCase = new CreateOfxImportPreview(
    new OfxJsParserAdapter(),
    repository,
    accountOwnership,
    findDuplicates,
    sourceObjectStore,
  );
  return {
    useCase,
    details,
    createPreview,
    putSource,
  };
}

describe('CreateOfxImportPreview', () => {
  it('validates the file and account before uploading and atomically saving a duplicate-aware preview', async () => {
    const { useCase, details, createPreview, putSource } =
      createUseCase();

    await expect(
      useCase.execute(
        context,
        bankFixture,
        destinationAccountId,
        'preview-key',
      ),
    ).resolves.toEqual(details);

    expect(putSource).toHaveBeenCalledOnce();
    expect(createPreview).toHaveBeenCalledOnce();
    expect(createPreview.mock.calls[0]?.[2]).toMatchObject([
      { externalId: 'synthetic-001', type: 'expense', amount: '25.90', isDuplicate: false },
    ]);
    expect(createPreview.mock.calls[0]?.[3]).toBe('preview-key');
  });

  it.each([
    ['PDF', 'unsupported-pdf.pdf'],
    ['non-OFX content', 'unsupported-content.txt'],
  ])('rejects %s before upload or persistence', async (_label, fixture) => {
    const { useCase, createPreview, putSource } = createUseCase();
    const content = readFileSync(
      new URL(`../../../../../test/fixtures/ofx/${fixture}`, import.meta.url),
    );

    await expect(
      useCase.execute(
        context,
        content,
        destinationAccountId,
        'invalid-file-key',
      ),
    ).rejects.toThrow();
    expect(putSource).not.toHaveBeenCalled();
    expect(createPreview).not.toHaveBeenCalled();
  });
});
