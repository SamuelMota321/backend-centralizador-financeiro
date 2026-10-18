import { Injectable } from '@nestjs/common';
import {
  AccountType as PrismaAccountType,
  PluggyAccountMappingStatus as PrismaMappingStatus,
  PluggyInitialImportStatus as PrismaRunStatus,
  ProviderDataAvailability as PrismaAvailability,
  Prisma,
} from '../../../../generated/prisma/client.js';
import { PrismaTenantTransaction } from '../../../../infrastructure/database/prisma-tenant-transaction.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import {
  PluggyInitialImportConflict,
  PluggyInitialImportIdempotencyConflict,
  PluggyInitialImportNotFound,
} from '../../domain/pluggy-initial-import.errors.js';
import type {
  PluggyDataAvailability,
  PluggyInitialImportAccount,
  PluggyInitialImportDetails,
  PluggyInitialImportRun,
} from '../../domain/pluggy-initial-import.js';
import type {
  IdempotencyReservation,
  MappingResult,
  PluggyImportAccountInput,
  PluggyImportCounts,
  PluggyInitialImportRepository,
} from '../../application/ports/pluggy-initial-import.repository.port.js';

const runSelect = {
  id: true,
  tenantId: true,
  connectionId: true,
  status: true,
  accountsAvailability: true,
  transactionsAvailability: true,
  accountsErrorCode: true,
  transactionsErrorCode: true,
  totalAccounts: true,
  mappedAccounts: true,
  totalTransactions: true,
  importedTransactions: true,
  ignoredTransactions: true,
  failedTransactions: true,
  terminalAt: true,
  retentionExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PluggyInitialImportRunSelect;

const accountSelect = {
  id: true,
  tenantId: true,
  importRunId: true,
  providerAccountId: true,
  name: true,
  accountType: true,
  currencyCode: true,
  balance: true,
  balanceAsOf: true,
  mappingStatus: true,
  errorCode: true,
  mappedAccountId: true,
} satisfies Prisma.PluggyInitialImportAccountSelect;

type RunRecord = Prisma.PluggyInitialImportRunGetPayload<{
  select: typeof runSelect;
}>;
type AccountRecord = Prisma.PluggyInitialImportAccountGetPayload<{
  select: typeof accountSelect;
}>;
type IdempotencyRecord = Readonly<{
  id: string;
  payload_hash: string;
  status: string;
  resource_ids: unknown;
  expires_at: Date | string;
}>;

const FROM_STATUS: Record<PrismaRunStatus, PluggyInitialImportRun['status']> = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  AWAITING_ACCOUNT_MAPPING: 'awaiting_account_mapping',
  COMPLETED: 'completed',
  COMPLETED_WITH_ERRORS: 'completed_with_errors',
  FAILED: 'failed',
};

const FROM_AVAILABILITY: Record<PrismaAvailability, PluggyDataAvailability> = {
  PENDING: 'pending',
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
};

const FROM_MAPPING_STATUS: Record<
  PrismaMappingStatus,
  PluggyInitialImportAccount['mappingStatus']
> = {
  PENDING: 'pending',
  MAPPED: 'mapped',
  UNSUPPORTED: 'unsupported',
};

const TO_ACCOUNT_TYPE: Record<
  NonNullable<PluggyImportAccountInput['accountType']>,
  PrismaAccountType
> = {
  checking: PrismaAccountType.CHECKING,
  savings: PrismaAccountType.SAVINGS,
  credit_card: PrismaAccountType.CREDIT_CARD,
};

@Injectable()
export class PrismaPluggyInitialImportRepository implements PluggyInitialImportRepository {
  constructor(private readonly tenantTransaction: PrismaTenantTransaction) {}

  reserveStart(
    context: TenantContext,
    idempotencyKey: string,
    payloadHash: string,
    now: Date,
  ): Promise<IdempotencyReservation> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const inserted = await transaction.$queryRaw<IdempotencyRecord[]>`
        INSERT INTO public.idempotency_keys (
          tenant_id, operation, key, payload_hash, status, resource_ids,
          created_at, expires_at
        ) VALUES (
          ${context.tenantId}::uuid, 'pluggy_initial_import_start',
          ${idempotencyKey}, ${payloadHash},
          'pending'::public.idempotency_status, '[]'::jsonb,
          ${now}, ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}
        )
        ON CONFLICT (tenant_id, operation, key) DO NOTHING
        RETURNING id, payload_hash, status, resource_ids, expires_at
      `;
      if (inserted[0]) return { claimId: inserted[0].id, replayRunId: null };

      const existing = await transaction.$queryRaw<IdempotencyRecord[]>`
        SELECT id, payload_hash, status, resource_ids, expires_at
        FROM public.idempotency_keys
        WHERE tenant_id = ${context.tenantId}::uuid
          AND operation = 'pluggy_initial_import_start'
          AND key = ${idempotencyKey}
        FOR UPDATE
      `;
      const record = existing[0];
      if (!record) throw new PluggyInitialImportIdempotencyConflict();
      if (record.payload_hash !== payloadHash) {
        throw new PluggyInitialImportIdempotencyConflict();
      }
      const expiresAt = new Date(record.expires_at).getTime();
      if (expiresAt <= now.getTime()) {
        if (record.status !== 'pending') {
          throw new PluggyInitialImportIdempotencyConflict();
        }
        const reclaimed = await transaction.$queryRaw<{ id: string }[]>`
          UPDATE public.idempotency_keys
          SET created_at = ${now},
              expires_at = ${new Date(now.getTime() + 24 * 60 * 60 * 1000)},
              resource_ids = '[]'::jsonb
          WHERE id = ${record.id}::uuid
            AND tenant_id = ${context.tenantId}::uuid
            AND status = 'pending'::public.idempotency_status
            AND expires_at <= ${now}
          RETURNING id
        `;
        if (!reclaimed[0]) throw new PluggyInitialImportIdempotencyConflict();
        return { claimId: reclaimed[0].id, replayRunId: null };
      }
      if (record.status === 'pending') {
        throw new PluggyInitialImportIdempotencyConflict();
      }
      if (record.status !== 'completed') {
        throw new PluggyInitialImportIdempotencyConflict();
      }
      const resources = readResourceIds(record.resource_ids);
      if (resources.length !== 1 || !isUuid(resources[0] ?? '')) {
        throw new PluggyInitialImportIdempotencyConflict();
      }
      return { claimId: null, replayRunId: resources[0]!.toLowerCase() };
    });
  }

  async releaseStart(context: TenantContext, claimId: string): Promise<void> {
    await this.tenantTransaction.run(context, async (transaction) => {
      await transaction.$executeRaw`
        UPDATE public.idempotency_keys
        SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'
        WHERE id = ${claimId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND operation = 'pluggy_initial_import_start'
          AND status = 'pending'::public.idempotency_status
      `;
    });
  }

  completeStart(
    context: TenantContext,
    connectionId: string,
    claimId: string,
  ): Promise<PluggyInitialImportDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const connection = await transaction.financialConnection.findFirst({
        where: { id: connectionId, tenantId: context.tenantId },
        select: { id: true },
      });
      if (!connection) throw new PluggyInitialImportNotFound();

      let run = await transaction.pluggyInitialImportRun.findUnique({
        where: {
          tenantId_connectionId: {
            tenantId: context.tenantId,
            connectionId,
          },
        },
        select: runSelect,
      });
      if (!run) {
        run = await transaction.pluggyInitialImportRun.create({
          data: { tenantId: context.tenantId, connectionId },
          select: runSelect,
        });
      }
      const updated = await transaction.$executeRaw`
        UPDATE public.idempotency_keys
        SET status = 'completed'::public.idempotency_status,
            resource_ids = ${JSON.stringify([run.id])}::jsonb
        WHERE id = ${claimId}::uuid
          AND tenant_id = ${context.tenantId}::uuid
          AND operation = 'pluggy_initial_import_start'
          AND status = 'pending'::public.idempotency_status
      `;
      if (updated !== 1) throw new PluggyInitialImportIdempotencyConflict();
      return findDetails(transaction, context, run.id);
    });
  }

  findById(
    context: TenantContext,
    runId: string,
  ): Promise<PluggyInitialImportDetails | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const run = await transaction.pluggyInitialImportRun.findFirst({
        where: { id: runId, tenantId: context.tenantId },
        select: { id: true },
      });
      return run ? findDetails(transaction, context, run.id) : null;
    });
  }

  findByConnection(
    context: TenantContext,
    connectionId: string,
  ): Promise<PluggyInitialImportDetails | null> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const run = await transaction.pluggyInitialImportRun.findUnique({
        where: {
          tenantId_connectionId: {
            tenantId: context.tenantId,
            connectionId,
          },
        },
        select: { id: true },
      });
      return run ? findDetails(transaction, context, run.id) : null;
    });
  }

  requeueFailed(
    context: TenantContext,
    runId: string,
  ): Promise<PluggyInitialImportRun> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const current = await transaction.pluggyInitialImportRun.findFirst({
        where: { id: runId, tenantId: context.tenantId },
        select: runSelect,
      });
      if (!current) throw new PluggyInitialImportNotFound();
      if (
        !['failed', 'completed_with_errors'].includes(
          FROM_STATUS[current.status],
        ) ||
        (current.accountsAvailability !== PrismaAvailability.FAILED &&
          current.transactionsAvailability !== PrismaAvailability.FAILED)
      ) {
        return toRun(current);
      }
      const updated = await transaction.pluggyInitialImportRun.update({
        where: { id: current.id },
        data: {
          status: PrismaRunStatus.QUEUED,
          accountsAvailability:
            current.accountsAvailability === PrismaAvailability.FAILED
              ? PrismaAvailability.PENDING
              : current.accountsAvailability,
          transactionsAvailability:
            current.transactionsAvailability === PrismaAvailability.FAILED
              ? PrismaAvailability.PENDING
              : current.transactionsAvailability,
          accountsErrorCode:
            current.accountsAvailability === PrismaAvailability.FAILED
              ? null
              : current.accountsErrorCode,
          transactionsErrorCode:
            current.transactionsAvailability === PrismaAvailability.FAILED
              ? null
              : current.transactionsErrorCode,
          terminalAt: null,
          retentionExpiresAt: null,
        },
        select: runSelect,
      });
      return toRun(updated);
    });
  }

  async claimWork(
    context: TenantContext,
    runId: string,
  ): Promise<'claimed' | 'busy' | 'not_queued'> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const claimed = await transaction.pluggyInitialImportRun.updateMany({
        where: {
          id: runId,
          tenantId: context.tenantId,
          status: PrismaRunStatus.QUEUED,
        },
        data: { status: PrismaRunStatus.PROCESSING },
      });
      if (claimed.count === 1) return 'claimed';
      const current = await transaction.pluggyInitialImportRun.findFirst({
        where: { id: runId, tenantId: context.tenantId },
        select: { status: true },
      });
      if (!current) throw new PluggyInitialImportNotFound();
      return current.status === PrismaRunStatus.PROCESSING
        ? 'busy'
        : 'not_queued';
    });
  }

  recordAccounts(
    context: TenantContext,
    runId: string,
    accounts: readonly PluggyImportAccountInput[],
    availability: PluggyDataAvailability,
    errorCode: string | null,
  ): Promise<PluggyInitialImportDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      for (const account of accounts) {
        const key = {
          tenantId_importRunId_providerAccountId: {
            tenantId: context.tenantId,
            importRunId: runId,
            providerAccountId: account.providerAccountId,
          },
        };
        const existing =
          await transaction.pluggyInitialImportAccount.findUnique({
            where: key,
            select: { mappingStatus: true },
          });
        if (existing?.mappingStatus === PrismaMappingStatus.MAPPED) continue;
        await transaction.pluggyInitialImportAccount.upsert({
          where: key,
          create: toAccountCreateData(context.tenantId, runId, account),
          update: toAccountUpdateData(account),
        });
      }

      const [totalAccounts, mappedAccounts, pendingAccounts] =
        await Promise.all([
          transaction.pluggyInitialImportAccount.count({
            where: { tenantId: context.tenantId, importRunId: runId },
          }),
          transaction.pluggyInitialImportAccount.count({
            where: {
              tenantId: context.tenantId,
              importRunId: runId,
              mappingStatus: PrismaMappingStatus.MAPPED,
            },
          }),
          transaction.pluggyInitialImportAccount.count({
            where: {
              tenantId: context.tenantId,
              importRunId: runId,
              mappingStatus: PrismaMappingStatus.PENDING,
            },
          }),
        ]);
      const current = await transaction.pluggyInitialImportRun.findFirst({
        where: { id: runId, tenantId: context.tenantId },
        select: { id: true },
      });
      if (!current) throw new PluggyInitialImportNotFound();
      await transaction.pluggyInitialImportRun.update({
        where: { id: runId },
        data: {
          accountsAvailability: TO_AVAILABILITY[availability],
          accountsErrorCode: errorCode,
          totalAccounts,
          mappedAccounts,
          status:
            pendingAccounts > 0
              ? PrismaRunStatus.AWAITING_ACCOUNT_MAPPING
              : PrismaRunStatus.QUEUED,
        },
      });
      return findDetails(transaction, context, runId);
    });
  }

  recordMapping(
    context: TenantContext,
    runId: string,
    providerAccountId: string,
    mappedAccountId: string,
  ): Promise<MappingResult> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const account = await transaction.pluggyInitialImportAccount.findFirst({
        where: {
          tenantId: context.tenantId,
          importRunId: runId,
          providerAccountId,
        },
        select: accountSelect,
      });
      if (!account) throw new PluggyInitialImportNotFound();
      if (account.mappingStatus === PrismaMappingStatus.UNSUPPORTED) {
        throw new PluggyInitialImportConflict();
      }
      if (account.mappingStatus === PrismaMappingStatus.MAPPED) {
        if (account.mappedAccountId !== mappedAccountId) {
          throw new PluggyInitialImportConflict();
        }
      } else {
        await transaction.pluggyInitialImportAccount.updateMany({
          where: {
            id: account.id,
            tenantId: context.tenantId,
            mappingStatus: PrismaMappingStatus.PENDING,
          },
          data: {
            mappingStatus: PrismaMappingStatus.MAPPED,
            mappedAccountId,
            errorCode: null,
          },
        });
      }
      const [mappedAccounts, pendingAccounts] = await Promise.all([
        transaction.pluggyInitialImportAccount.count({
          where: {
            tenantId: context.tenantId,
            importRunId: runId,
            mappingStatus: PrismaMappingStatus.MAPPED,
          },
        }),
        transaction.pluggyInitialImportAccount.count({
          where: {
            tenantId: context.tenantId,
            importRunId: runId,
            mappingStatus: PrismaMappingStatus.PENDING,
          },
        }),
      ]);
      await transaction.pluggyInitialImportRun.updateMany({
        where: { id: runId, tenantId: context.tenantId },
        data: {
          mappedAccounts,
          status:
            pendingAccounts === 0
              ? PrismaRunStatus.QUEUED
              : PrismaRunStatus.AWAITING_ACCOUNT_MAPPING,
          terminalAt: null,
          retentionExpiresAt: null,
        },
      });
      return {
        details: await findDetails(transaction, context, runId),
        shouldQueueTransactions: pendingAccounts === 0 && mappedAccounts > 0,
      };
    });
  }

  finishTransactions(
    context: TenantContext,
    runId: string,
    availability: PluggyDataAvailability,
    errorCode: string | null,
    counts: PluggyImportCounts,
    now: Date,
  ): Promise<PluggyInitialImportDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const unsupportedAccounts =
        await transaction.pluggyInitialImportAccount.count({
          where: {
            tenantId: context.tenantId,
            importRunId: runId,
            mappingStatus: PrismaMappingStatus.UNSUPPORTED,
          },
        });
      const hasErrors =
        availability === 'failed' ||
        counts.failedTransactions > 0 ||
        unsupportedAccounts > 0;
      await transaction.pluggyInitialImportRun.updateMany({
        where: { id: runId, tenantId: context.tenantId },
        data: {
          status: hasErrors
            ? PrismaRunStatus.COMPLETED_WITH_ERRORS
            : PrismaRunStatus.COMPLETED,
          transactionsAvailability: TO_AVAILABILITY[availability],
          transactionsErrorCode: errorCode,
          totalTransactions: counts.totalTransactions,
          importedTransactions: counts.importedTransactions,
          ignoredTransactions: counts.ignoredTransactions,
          failedTransactions: counts.failedTransactions,
          terminalAt: now,
          retentionExpiresAt: new Date(
            now.getTime() + 90 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      return findDetails(transaction, context, runId);
    });
  }

  finishWithoutTransactions(
    context: TenantContext,
    runId: string,
    availability: PluggyDataAvailability,
    now: Date,
  ): Promise<PluggyInitialImportDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const [current, unsupportedAccounts] = await Promise.all([
        transaction.pluggyInitialImportRun.findFirst({
          where: { id: runId, tenantId: context.tenantId },
          select: { accountsAvailability: true },
        }),
        transaction.pluggyInitialImportAccount.count({
          where: {
            tenantId: context.tenantId,
            importRunId: runId,
            mappingStatus: PrismaMappingStatus.UNSUPPORTED,
          },
        }),
      ]);
      if (!current) throw new PluggyInitialImportNotFound();
      const hasErrors =
        unsupportedAccounts > 0 ||
        current.accountsAvailability === PrismaAvailability.FAILED;
      await transaction.pluggyInitialImportRun.updateMany({
        where: { id: runId, tenantId: context.tenantId },
        data: {
          status: hasErrors
            ? PrismaRunStatus.COMPLETED_WITH_ERRORS
            : PrismaRunStatus.COMPLETED,
          transactionsAvailability: TO_AVAILABILITY[availability],
          terminalAt: now,
          retentionExpiresAt: new Date(
            now.getTime() + 90 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      return findDetails(transaction, context, runId);
    });
  }

  finishAccountFailure(
    context: TenantContext,
    runId: string,
    errorCode: string,
    now: Date,
  ): Promise<PluggyInitialImportDetails> {
    return this.tenantTransaction.run(context, async (transaction) => {
      const totalAccounts = await transaction.pluggyInitialImportAccount.count({
        where: { tenantId: context.tenantId, importRunId: runId },
      });
      await transaction.pluggyInitialImportRun.updateMany({
        where: { id: runId, tenantId: context.tenantId },
        data: {
          status:
            totalAccounts > 0
              ? PrismaRunStatus.COMPLETED_WITH_ERRORS
              : PrismaRunStatus.FAILED,
          accountsAvailability: PrismaAvailability.FAILED,
          accountsErrorCode: errorCode,
          transactionsAvailability: PrismaAvailability.UNAVAILABLE,
          transactionsErrorCode: null,
          terminalAt: now,
          retentionExpiresAt: new Date(
            now.getTime() + 90 * 24 * 60 * 60 * 1000,
          ),
        },
      });
      return findDetails(transaction, context, runId);
    });
  }
}

const TO_AVAILABILITY: Record<PluggyDataAvailability, PrismaAvailability> = {
  pending: PrismaAvailability.PENDING,
  available: PrismaAvailability.AVAILABLE,
  unavailable: PrismaAvailability.UNAVAILABLE,
  failed: PrismaAvailability.FAILED,
};

async function findDetails(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  runId: string,
): Promise<PluggyInitialImportDetails> {
  const run = await transaction.pluggyInitialImportRun.findFirst({
    where: { id: runId, tenantId: context.tenantId },
    select: runSelect,
  });
  if (!run) throw new PluggyInitialImportNotFound();
  const accounts = await transaction.pluggyInitialImportAccount.findMany({
    where: { tenantId: context.tenantId, importRunId: run.id },
    select: accountSelect,
    orderBy: [{ createdAt: 'asc' }, { providerAccountId: 'asc' }],
  });
  return { run: toRun(run), accounts: accounts.map(toAccount) };
}

function toRun(record: RunRecord): PluggyInitialImportRun {
  return {
    id: record.id,
    connectionId: record.connectionId,
    status: FROM_STATUS[record.status],
    accountsAvailability: FROM_AVAILABILITY[record.accountsAvailability],
    transactionsAvailability:
      FROM_AVAILABILITY[record.transactionsAvailability],
    accountsErrorCode: record.accountsErrorCode,
    transactionsErrorCode: record.transactionsErrorCode,
    totalAccounts: record.totalAccounts,
    mappedAccounts: record.mappedAccounts,
    totalTransactions: record.totalTransactions,
    importedTransactions: record.importedTransactions,
    ignoredTransactions: record.ignoredTransactions,
    failedTransactions: record.failedTransactions,
    terminalAt: record.terminalAt?.toISOString() ?? null,
    retentionExpiresAt: record.retentionExpiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toAccount(record: AccountRecord): PluggyInitialImportAccount {
  return {
    providerAccountId: record.providerAccountId,
    name: record.name,
    accountType: record.accountType
      ? fromAccountType(record.accountType)
      : null,
    currencyCode: record.currencyCode,
    mappingStatus: FROM_MAPPING_STATUS[record.mappingStatus],
    errorCode: record.errorCode,
    mappedAccountId: record.mappedAccountId,
    balance: record.balance?.toFixed(2) ?? null,
    balanceAsOf: record.balanceAsOf?.toISOString().slice(0, 10) ?? null,
  };
}

function toAccountCreateData(
  tenantId: string,
  runId: string,
  input: PluggyImportAccountInput,
) {
  return {
    tenantId,
    importRunId: runId,
    providerAccountId: input.providerAccountId,
    name: input.name,
    accountType: input.accountType ? TO_ACCOUNT_TYPE[input.accountType] : null,
    currencyCode: input.currencyCode,
    balance: input.balance,
    balanceAsOf: input.balanceAsOf
      ? new Date(`${input.balanceAsOf}T00:00:00.000Z`)
      : null,
    mappingStatus: input.errorCode
      ? PrismaMappingStatus.UNSUPPORTED
      : PrismaMappingStatus.PENDING,
    errorCode: input.errorCode,
  };
}

function toAccountUpdateData(input: PluggyImportAccountInput) {
  return {
    name: input.name,
    accountType: input.accountType ? TO_ACCOUNT_TYPE[input.accountType] : null,
    currencyCode: input.currencyCode,
    balance: input.balance,
    balanceAsOf: input.balanceAsOf
      ? new Date(`${input.balanceAsOf}T00:00:00.000Z`)
      : null,
    mappingStatus: input.errorCode
      ? PrismaMappingStatus.UNSUPPORTED
      : PrismaMappingStatus.PENDING,
    mappedAccountId: null,
    errorCode: input.errorCode,
  };
}

function fromAccountType(
  type: PrismaAccountType,
): 'checking' | 'savings' | 'credit_card' | null {
  if (type === PrismaAccountType.CHECKING) return 'checking';
  if (type === PrismaAccountType.SAVINGS) return 'savings';
  if (type === PrismaAccountType.CREDIT_CARD) return 'credit_card';
  return null;
}

function readResourceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new PluggyInitialImportIdempotencyConflict();
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
