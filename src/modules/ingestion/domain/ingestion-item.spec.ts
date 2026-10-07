import { describe, expect, it } from 'vitest';
import { IngestionItem } from './ingestion-item.js';
import { InvalidImportRunTransition } from './ingestion.errors.js';

const preview = IngestionItem.preview({
  ordinal: 1,
  externalId: 'synthetic-fitid',
  type: 'expense',
  amount: '10.00',
  occurredOn: '2026-10-01',
  description: 'Synthetic fixture',
  warnings: [],
});

describe('IngestionItem', () => {
  it('records imported and duplicate outcomes with explicit duplicate state', () => {
    expect(preview.markImported().props).toMatchObject({
      status: 'imported',
      isDuplicate: false,
      errorCode: null,
    });
    expect(preview.markIgnoredDuplicate().props).toMatchObject({
      status: 'ignored_duplicate',
      isDuplicate: true,
      errorCode: null,
    });
  });

  it('records only a stable error code on failure and disallows a second terminal transition', () => {
    const failed = preview.markFailed('transaction_invalid');
    expect(failed.props).toMatchObject({
      status: 'failed',
      errorCode: 'transaction_invalid',
    });
    expect(() => failed.markImported()).toThrow(InvalidImportRunTransition);
  });
});
