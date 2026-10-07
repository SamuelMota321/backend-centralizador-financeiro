import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ImportRun } from './import-run.js';
import { InvalidImportRunTransition } from './ingestion.errors.js';

describe('ImportRun', () => {
  it('moves through the approved lifecycle and retains terminal metadata for 90 days', () => {
    const preview = ImportRun.createPreview({
      tenantId: randomUUID(),
      variant: 'ofx_1_sgml',
      fileSizeBytes: 100,
      contentSha256: 'a'.repeat(64),
      totalItems: 3,
      now: '2026-10-07T12:00:00.000Z',
    });

    const queued = preview.transition('queued', '2026-10-07T12:01:00.000Z');
    const processing = queued.transition(
      'processing',
      '2026-10-07T12:02:00.000Z',
    );
    const completed = processing.transition(
      'completed',
      '2026-10-07T12:03:00.000Z',
    );
    expect(completed.props).toMatchObject({
      status: 'completed',
      terminalAt: '2026-10-07T12:03:00.000Z',
      retentionExpiresAt: '2027-01-05T12:03:00.000Z',
    });
    expect(() =>
      completed.transition('failed', '2026-10-07T12:04:00.000Z'),
    ).toThrow(InvalidImportRunTransition);
  });
});
