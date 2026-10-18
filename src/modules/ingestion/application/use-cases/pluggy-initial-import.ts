import { createHash, randomUUID } from 'node:crypto';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type {
  PluggyAccountsPage,
  PluggyProvider,
  PluggyTransactionSnapshot,
} from '../../../accounts/application/ports/pluggy-provider.port.js';
import type { ConnectionsCollectionEligibility } from '../../../accounts/application/ports/connections.repository.port.js';
import type {
  AssociatePluggyAccount,
  CreatePluggyConnectedAccount,
} from '../../../accounts/application/use-cases/pluggy-account-mapping.js';
import type { PluggyConnectionLifecycle } from '../../../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import { PluggyUnavailable } from '../../../accounts/adapters/outbound/pluggy-api.client.js';
import type { PluggyInitialImportJob } from '../../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import type { QStashPluggyWebhookService } from '../../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import type { ImportPluggyTransaction } from '../../../transactions/application/use-cases/import-pluggy-transaction.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../../../transactions/application/transactions.errors.js';
import type {
  PluggyInitialImportRepository,
  PluggyImportAccountInput,
} from '../ports/pluggy-initial-import.repository.port.js';
import {
  PluggyInitialImportConflict,
  PluggyInitialImportIdempotencyConflict,
  PluggyInitialImportNotFound,
} from '../../domain/pluggy-initial-import.errors.js';
import {
  toPluggyInitialImportView,
  type PluggyInitialImportAccount,
  type PluggyInitialImportDetails,
  type PluggyInitialImportView,
} from '../../domain/pluggy-initial-import.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type PluggyAccountMappingChoice =
  | Readonly<{ action: 'link'; accountId: string }>
  | Readonly<{ action: 'create' }>;

export type PluggyCompletionAccepted = Readonly<{
  connection: Awaited<ReturnType<PluggyConnectionLifecycle['complete']>>;
  initialImport: PluggyInitialImportView;
}>;

export class PluggyInitialImport {
  constructor(
    private readonly repository: PluggyInitialImportRepository,
    private readonly lifecycle: PluggyConnectionLifecycle,
    private readonly eligibility: ConnectionsCollectionEligibility,
    private readonly provider: PluggyProvider,
    private readonly createConnectedAccount: CreatePluggyConnectedAccount,
    private readonly associateAccount: AssociatePluggyAccount,
    private readonly importTransaction: ImportPluggyTransaction,
    private readonly queue: QStashPluggyWebhookService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async complete(
    context: TenantContext,
    itemId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<PluggyCompletionAccepted> {
    if (idempotencyKey.length < 1 || idempotencyKey.length > 255) {
      throw new PluggyInitialImportConflict();
    }
    const payloadHash = createHash('sha256')
      .update(itemId.toLowerCase(), 'utf8')
      .digest('hex');
    const reservation = await this.repository.reserveStart(
      context,
      idempotencyKey,
      payloadHash,
      this.now(),
    );

    if (reservation.replayRunId) {
      const existing = await this.repository.findById(
        context,
        reservation.replayRunId,
      );
      if (!existing) throw new PluggyInitialImportIdempotencyConflict();
      const retried = await this.repository.requeueFailed(
        context,
        existing.run.id,
      );
      if (retried.status === 'queued') {
        await this.queue.publishInitialImport(retried.id, context);
      }
      const connection = await this.lifecycle.get(
        context,
        existing.run.connectionId,
        requestId,
      );
      const latest = await this.repository.findById(context, existing.run.id);
      if (!latest) throw new PluggyInitialImportNotFound();
      return {
        connection,
        initialImport: toPluggyInitialImportView(latest),
      };
    }

    const claimId = reservation.claimId;
    if (!claimId) throw new PluggyInitialImportIdempotencyConflict();
    let started = false;
    try {
      const connection = await this.lifecycle.complete(
        context,
        itemId,
        requestId,
      );
      if (connection.consent.status !== 'granted') {
        throw new PluggyInitialImportConflict();
      }
      const details = await this.repository.completeStart(
        context,
        connection.id,
        claimId,
      );
      started = true;
      await this.queue.publishInitialImport(details.run.id, context);
      return {
        connection,
        initialImport: toPluggyInitialImportView(details),
      };
    } catch (error: unknown) {
      if (!started) await this.repository.releaseStart(context, claimId);
      throw error;
    }
  }

  async get(
    context: TenantContext,
    connectionId: string,
    requestId: string,
  ): Promise<
    Awaited<ReturnType<PluggyConnectionLifecycle['get']>> & {
      initialImport: PluggyInitialImportView | null;
    }
  > {
    const connection = await this.lifecycle.get(
      context,
      connectionId,
      requestId,
    );
    const details = await this.repository.findByConnection(
      context,
      connectionId,
    );
    return {
      ...connection,
      initialImport: details ? toPluggyInitialImportView(details) : null,
    };
  }

  async mapAccount(
    context: TenantContext,
    connectionId: string,
    providerAccountId: string,
    choice: PluggyAccountMappingChoice,
    requestId: string,
  ): Promise<
    Readonly<{ accountId: string; initialImport: PluggyInitialImportView }>
  > {
    if (
      !UUID_PATTERN.test(connectionId) ||
      !UUID_PATTERN.test(providerAccountId)
    ) {
      throw new PluggyInitialImportConflict();
    }
    const details = await this.repository.findByConnection(
      context,
      connectionId,
    );
    if (!details) throw new PluggyInitialImportNotFound();
    const account = details.accounts.find(
      (candidate) => candidate.providerAccountId === providerAccountId,
    );
    if (!account || account.mappingStatus === 'unsupported') {
      throw new PluggyInitialImportConflict();
    }
    if (
      !(await this.eligibility.canStartCollection(
        context,
        connectionId,
        requestId,
      ))
    ) {
      throw new PluggyInitialImportConflict();
    }

    let accountId: string;
    if (choice.action === 'link') {
      accountId = choice.accountId;
      await this.associateAccount.execute(
        context,
        { connectionId, accountId, providerAccountId },
        requestId,
      );
    } else {
      if (
        !account.accountType ||
        account.currencyCode !== 'BRL' ||
        account.balance === null ||
        account.balanceAsOf === null
      ) {
        throw new PluggyInitialImportConflict();
      }
      const created = await this.createConnectedAccount.execute(
        context,
        {
          connectionId,
          providerAccountId,
          name: account.name,
          type: account.accountType,
          balance: account.balance,
          balanceAsOf: account.balanceAsOf,
        },
        requestId,
      );
      accountId = created.id;
    }

    const mapped = await this.repository.recordMapping(
      context,
      details.run.id,
      providerAccountId,
      accountId,
    );
    if (mapped.shouldQueueTransactions) {
      await this.queue.publishInitialImport(mapped.details.run.id, context);
    }
    return {
      accountId,
      initialImport: toPluggyInitialImportView(mapped.details),
    };
  }

  async processJob(job: PluggyInitialImportJob): Promise<void> {
    const context = { tenantId: job.tenantId, userId: job.userId };
    const details = await this.repository.findById(context, job.runId);
    if (!details) throw new PluggyInitialImportNotFound();
    const claim = await this.repository.claimWork(context, job.runId);
    if (claim !== 'claimed') return;

    if (details.run.accountsAvailability === 'pending') {
      await this.collectAccounts(context, details, randomUUID());
      const refreshed = await this.repository.findById(context, job.runId);
      if (!refreshed || refreshed.run.status !== 'processing') return;
      if (
        refreshed.accounts.some(
          (account) => account.mappingStatus === 'pending',
        )
      ) {
        return;
      }
      await this.collectTransactions(context, refreshed, randomUUID());
      return;
    }
    await this.collectTransactions(context, details, randomUUID());
  }

  private async collectAccounts(
    context: TenantContext,
    details: PluggyInitialImportDetails,
    requestId: string,
  ): Promise<void> {
    const connection = await this.lifecycle.get(
      context,
      details.run.connectionId,
      requestId,
    );
    const reference = await this.lifecycle.getCollectionReference(
      context,
      details.run.connectionId,
    );
    if (!reference) {
      await this.repository.recordAccounts(
        context,
        details.run.id,
        [],
        'unavailable',
        null,
      );
      await this.repository.finishWithoutTransactions(
        context,
        details.run.id,
        'unavailable',
        this.now(),
      );
      return;
    }
    const canReadBankAccounts = hasProduct(
      connection.consent.products,
      'ACCOUNTS',
    );
    const canReadCreditCards = hasProduct(
      connection.consent.products,
      'CREDIT_CARDS',
    );
    if (!canReadBankAccounts && !canReadCreditCards) {
      await this.repository.recordAccounts(
        context,
        details.run.id,
        [],
        'unavailable',
        null,
      );
      await this.repository.finishWithoutTransactions(
        context,
        details.run.id,
        'unavailable',
        this.now(),
      );
      return;
    }

    const accounts: PluggyImportAccountInput[] = [];
    try {
      let pageNumber = 1;
      let totalPages = 1;
      do {
        if (
          !(await this.eligibility.canStartCollection(
            context,
            details.run.connectionId,
            requestId,
          ))
        ) {
          await this.repository.recordAccounts(
            context,
            details.run.id,
            accounts,
            'unavailable',
            null,
          );
          await this.repository.finishWithoutTransactions(
            context,
            details.run.id,
            'unavailable',
            this.now(),
          );
          return;
        }
        const page = await this.provider.listAccounts(
          reference.providerItemId,
          pageNumber,
        );
        totalPages = page.totalPages;
        for (const providerAccount of page.accounts) {
          const account = mapProviderAccount(
            providerAccount,
            canReadBankAccounts,
            canReadCreditCards,
            this.now(),
          );
          if (account) accounts.push(account);
        }
        pageNumber += 1;
      } while (pageNumber <= totalPages);

      const saved = await this.repository.recordAccounts(
        context,
        details.run.id,
        accounts,
        'available',
        null,
      );
      if (
        saved.accounts.some((account) => account.mappingStatus === 'pending')
      ) {
        return;
      }
      await this.collectTransactions(context, saved, requestId);
    } catch (error: unknown) {
      if (!(error instanceof PluggyUnavailable)) throw error;
      await this.repository.finishAccountFailure(
        context,
        details.run.id,
        'provider_unavailable',
        this.now(),
      );
    }
  }

  private async collectTransactions(
    context: TenantContext,
    details: PluggyInitialImportDetails,
    requestId: string,
  ): Promise<void> {
    const connection = await this.lifecycle.get(
      context,
      details.run.connectionId,
      requestId,
    );
    const reference = await this.lifecycle.getCollectionReference(
      context,
      details.run.connectionId,
    );
    if (!reference) {
      await this.repository.finishWithoutTransactions(
        context,
        details.run.id,
        'unavailable',
        this.now(),
      );
      return;
    }

    const accounts = details.accounts.filter(
      (account) =>
        account.mappingStatus === 'mapped' && account.mappedAccountId !== null,
    );
    const eligibleAccounts = hasProduct(
      connection.consent.products,
      'TRANSACTIONS',
    )
      ? accounts
      : [];
    if (eligibleAccounts.length === 0) {
      await this.repository.finishWithoutTransactions(
        context,
        details.run.id,
        'unavailable',
        this.now(),
      );
      return;
    }

    const counts: {
      totalTransactions: number;
      importedTransactions: number;
      ignoredTransactions: number;
      failedTransactions: number;
    } = {
      totalTransactions: 0,
      importedTransactions: 0,
      ignoredTransactions: 0,
      failedTransactions: 0,
    };
    try {
      for (const account of eligibleAccounts) {
        let next: string | null = null;
        const seenCursors = new Set<string>();
        do {
          if (
            !(await this.eligibility.canStartCollection(
              context,
              details.run.connectionId,
              requestId,
            ))
          ) {
            await this.repository.finishTransactions(
              context,
              details.run.id,
              'unavailable',
              null,
              counts,
              this.now(),
            );
            return;
          }
          const page = await this.provider.listTransactions(
            account.providerAccountId,
            next,
          );
          for (const transaction of page.transactions) {
            await this.importProviderTransaction(
              context,
              details,
              account,
              transaction,
              counts,
              requestId,
            );
          }
          if (page.next && seenCursors.has(page.next)) {
            await this.repository.finishTransactions(
              context,
              details.run.id,
              'failed',
              'invalid_provider_pagination',
              counts,
              this.now(),
            );
            return;
          }
          if (page.next) seenCursors.add(page.next);
          next = page.next;
        } while (next !== null);
      }
      await this.repository.finishTransactions(
        context,
        details.run.id,
        'available',
        null,
        counts,
        this.now(),
      );
    } catch (error: unknown) {
      if (!(error instanceof PluggyUnavailable)) throw error;
      await this.repository.finishTransactions(
        context,
        details.run.id,
        'failed',
        'provider_unavailable',
        counts,
        this.now(),
      );
    }
  }

  private async importProviderTransaction(
    context: TenantContext,
    details: PluggyInitialImportDetails,
    account: PluggyInitialImportAccount,
    providerTransaction: PluggyTransactionSnapshot,
    counts: {
      totalTransactions: number;
      importedTransactions: number;
      ignoredTransactions: number;
      failedTransactions: number;
    },
    requestId: string,
  ): Promise<void> {
    counts.totalTransactions += 1;
    if (
      providerTransaction.accountId !== account.providerAccountId ||
      !UUID_PATTERN.test(providerTransaction.id)
    ) {
      counts.failedTransactions += 1;
      return;
    }
    if (providerTransaction.status !== 'POSTED') {
      counts.ignoredTransactions += 1;
      return;
    }
    if (providerTransaction.currencyCode !== 'BRL') {
      counts.failedTransactions += 1;
      return;
    }
    try {
      const result = await this.importTransaction.execute(
        context,
        {
          connectionId: details.run.connectionId,
          accountId: account.mappedAccountId!,
          providerAccountId: account.providerAccountId,
          providerTransactionId: providerTransaction.id,
          type: providerTransaction.type === 'CREDIT' ? 'income' : 'expense',
          amount: providerTransaction.amount,
          occurredOn: providerTransaction.date.slice(0, 10),
          description: providerTransaction.description,
        },
        requestId,
      );
      if (result.disposition === 'imported') counts.importedTransactions += 1;
      else counts.ignoredTransactions += 1;
    } catch (error: unknown) {
      if (
        error instanceof InvalidTransactionRequest ||
        error instanceof TransactionAccountArchived ||
        error instanceof TransactionAccountNotFound
      ) {
        counts.failedTransactions += 1;
        return;
      }
      throw error;
    }
  }
}

function hasProduct(products: readonly string[], product: string): boolean {
  return products.includes(product);
}

function mapProviderAccount(
  account: PluggyAccountsPage['accounts'][number],
  canReadBankAccounts: boolean,
  canReadCreditCards: boolean,
  now: Date,
): PluggyImportAccountInput | null {
  const isBank = account.type === 'BANK';
  const isCredit = account.type === 'CREDIT';
  if (!isBank && !isCredit) return null;
  if ((isBank && !canReadBankAccounts) || (isCredit && !canReadCreditCards)) {
    return null;
  }

  const accountType =
    isBank && account.subtype === 'CHECKING_ACCOUNT'
      ? 'checking'
      : isBank && account.subtype === 'SAVINGS_ACCOUNT'
        ? 'savings'
        : isCredit && account.subtype === 'CREDIT_CARD'
          ? 'credit_card'
          : null;
  let errorCode: string | null = null;
  if (!accountType) errorCode = 'unsupported_account_type';
  else if (account.currencyCode !== 'BRL') errorCode = 'unsupported_currency';
  else if (account.name.trim().length === 0 || account.name.length > 100) {
    errorCode = 'unsupported_account_name';
  }

  return {
    providerAccountId: account.id,
    name: account.name.trim().slice(0, 100),
    accountType,
    currencyCode: account.currencyCode,
    balance: errorCode === null ? account.balance : null,
    balanceAsOf: errorCode === null ? now.toISOString().slice(0, 10) : null,
    errorCode,
  };
}
