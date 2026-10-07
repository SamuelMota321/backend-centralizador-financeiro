import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import { InvalidOfxFile } from '../../domain/ingestion.errors.js';
import type { ImportRun, ImportRunSnapshot } from '../../domain/import-run.js';
import type { ParsedOfxTransaction } from '../../domain/ofx-statement.js';
import type { IngestionRepository } from '../ports/ingestion.repository.port.js';
import { OfxJsParserAdapter } from '../../adapters/outbound/ofx-js-parser.adapter.js';
import { CreateOfxImportPreview } from './create-ofx-import-preview.js';

const context: TenantContext = { tenantId: randomUUID(), userId: randomUUID() };
const bankFixture = readFileSync(
  new URL(
    '../../../../../test/fixtures/ofx/ofx-1-bank-ascii.ofx',
    import.meta.url,
  ),
);

describe('CreateOfxImportPreview', () => {
  it('validates the whole file before atomically asking persistence to save the run and items', async () => {
    const result: ImportRunSnapshot = {
      id: randomUUID(),
      tenantId: context.tenantId,
      destinationAccountId: null,
      status: 'preview_ready',
      variant: 'ofx_1_sgml',
      fileSizeBytes: bankFixture.byteLength,
      contentSha256: createHash('sha256').update(bankFixture).digest('hex'),
      sourceObjectReference: null,
      totalItems: 1,
      importedItems: 0,
      ignoredItems: 0,
      failedItems: 0,
      terminalAt: null,
      retentionExpiresAt: null,
      createdAt: '2026-10-07T12:00:00.000Z',
      updatedAt: '2026-10-07T12:00:00.000Z',
    };
    const createPreview = vi.fn(
      (
        _context: TenantContext,
        _run: ImportRun,
        _items: readonly ParsedOfxTransaction[],
      ) => Promise.resolve(result),
    );
    const repository: IngestionRepository = {
      createPreview,
      findRun: vi.fn(),
      transitionRun: vi.fn(),
    };
    const useCase = new CreateOfxImportPreview(
      new OfxJsParserAdapter(),
      repository,
    );

    await expect(useCase.execute(context, bankFixture)).resolves.toEqual(
      result,
    );
    expect(createPreview).toHaveBeenCalledOnce();
    expect(createPreview.mock.calls[0]?.[2]).toMatchObject([
      { externalId: 'synthetic-001', type: 'expense', amount: '25.90' },
    ]);
    expect(createPreview.mock.calls[0]?.[1].props.contentSha256).toBe(
      result.contentSha256,
    );
  });

  it.each([
    ['PDF', 'unsupported-pdf.pdf'],
    ['non-OFX content', 'unsupported-content.txt'],
  ])('rejects %s without calling persistence', async (_label, fixture) => {
    const repository: IngestionRepository = {
      createPreview: vi.fn(),
      findRun: vi.fn(),
      transitionRun: vi.fn(),
    };
    const useCase = new CreateOfxImportPreview(
      new OfxJsParserAdapter(),
      repository,
    );
    const content = readFileSync(
      new URL(`../../../../../test/fixtures/ofx/${fixture}`, import.meta.url),
    );

    await expect(useCase.execute(context, content)).rejects.toThrow(
      InvalidOfxFile,
    );
    expect(repository.createPreview).not.toHaveBeenCalled();
  });
});
