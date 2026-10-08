import type { ImportRunDetails } from './ports/ingestion.repository.port.js';

export function toImportRunView(details: ImportRunDetails) {
  const { run } = details;
  return {
    id: run.id,
    destinationAccountId: run.destinationAccountId,
    status: run.status,
    variant: run.variant,
    fileSizeBytes: run.fileSizeBytes,
    totalItems: run.totalItems,
    importedItems: run.importedItems,
    ignoredItems: run.ignoredItems,
    failedItems: run.failedItems,
    terminalAt: run.terminalAt,
    retentionExpiresAt: run.retentionExpiresAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    items: details.items.map((item) => ({ ...item })),
  };
}
