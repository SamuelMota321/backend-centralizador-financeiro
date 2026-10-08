import { InvalidImportRunTransition } from './ingestion.errors.js';
import type { OfxVariant } from './ofx-statement.js';

export type ImportRunStatus =
  | 'preview_ready'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'expired';

export type ImportRunSnapshot = Readonly<{
  id: string;
  tenantId: string;
  destinationAccountId: string | null;
  status: ImportRunStatus;
  variant: OfxVariant;
  fileSizeBytes: number;
  contentSha256: string;
  sourceObjectReference: string | null;
  totalItems: number;
  importedItems: number;
  ignoredItems: number;
  failedItems: number;
  terminalAt: string | null;
  retentionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ImportRunState = Omit<ImportRunSnapshot, 'id' | 'createdAt'> &
  Readonly<{ id: string | null; createdAt: string | null }>;

const TERMINAL_STATUSES = new Set<ImportRunStatus>([
  'completed',
  'completed_with_errors',
  'failed',
  'expired',
]);

export class ImportRun {
  private constructor(readonly props: ImportRunState) {}

  static createPreview(
    input: Readonly<{
      tenantId: string;
      destinationAccountId: string;
      variant: OfxVariant;
      fileSizeBytes: number;
      contentSha256: string;
      sourceObjectReference: string;
      totalItems: number;
      now: string;
    }>,
  ): ImportRun {
    if (
      input.fileSizeBytes < 1 ||
      input.fileSizeBytes > 10 * 1024 * 1024 ||
      !Number.isInteger(input.fileSizeBytes) ||
      !/^[0-9a-f]{64}$/u.test(input.contentSha256) ||
      input.totalItems < 0 ||
      !Number.isInteger(input.totalItems)
    ) {
      throw new InvalidImportRunTransition('Import run metadata is invalid.');
    }
    const now = parseTimestamp(input.now);
    return new ImportRun({
      id: null,
      tenantId: input.tenantId,
      destinationAccountId: input.destinationAccountId,
      status: 'preview_ready',
      variant: input.variant,
      fileSizeBytes: input.fileSizeBytes,
      contentSha256: input.contentSha256,
      sourceObjectReference: input.sourceObjectReference,
      totalItems: input.totalItems,
      importedItems: 0,
      ignoredItems: 0,
      failedItems: 0,
      terminalAt: null,
      retentionExpiresAt: null,
      createdAt: null,
      updatedAt: now,
    });
  }

  static reconstitute(snapshot: ImportRunSnapshot): ImportRun {
    return new ImportRun({ ...snapshot });
  }

  transition(nextStatus: ImportRunStatus, now: string): ImportRun {
    const allowedTransitions: Readonly<
      Record<ImportRunStatus, readonly ImportRunStatus[]>
    > = {
      preview_ready: ['queued', 'processing', 'failed', 'expired'],
      queued: ['processing', 'failed'],
      processing: ['completed', 'completed_with_errors', 'failed'],
      completed: [],
      completed_with_errors: [],
      failed: [],
      expired: [],
    };
    if (!allowedTransitions[this.props.status].includes(nextStatus)) {
      throw new InvalidImportRunTransition(
        `Cannot transition an import run from ${this.props.status} to ${nextStatus}.`,
      );
    }

    const timestamp = parseTimestamp(now);
    const isTerminal = TERMINAL_STATUSES.has(nextStatus);
    const terminalDate = isTerminal ? new Date(timestamp) : null;
    if (terminalDate) terminalDate.setUTCDate(terminalDate.getUTCDate() + 90);
    return new ImportRun({
      ...this.props,
      status: nextStatus,
      terminalAt: isTerminal ? timestamp : null,
      retentionExpiresAt: terminalDate?.toISOString() ?? null,
      updatedAt: timestamp,
    });
  }

  finish(
    counts: Readonly<{
      importedItems: number;
      ignoredItems: number;
      failedItems: number;
    }>,
    now: string,
  ): ImportRun {
    if (this.props.status !== 'processing') {
      throw new InvalidImportRunTransition(
        'Only a processing import run can be completed.',
      );
    }
    const values = Object.values(counts);
    if (
      values.some((value) => !Number.isInteger(value) || value < 0) ||
      values.reduce((total, value) => total + value, 0) !==
        this.props.totalItems
    ) {
      throw new InvalidImportRunTransition('Import result counts are invalid.');
    }

    const timestamp = parseTimestamp(now);
    const terminalDate = new Date(timestamp);
    terminalDate.setUTCDate(terminalDate.getUTCDate() + 90);
    return new ImportRun({
      ...this.props,
      ...counts,
      status: counts.failedItems > 0 ? 'completed_with_errors' : 'completed',
      terminalAt: timestamp,
      retentionExpiresAt: terminalDate.toISOString(),
      updatedAt: timestamp,
    });
  }
}

function parseTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new InvalidImportRunTransition('Import run timestamp is invalid.');
  }
  return timestamp.toISOString();
}
