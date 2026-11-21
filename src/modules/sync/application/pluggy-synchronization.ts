import { randomUUID } from 'node:crypto';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type {
  PluggyProvider,
  PluggyInvestmentSnapshot,
  PluggyItemSnapshot,
} from '../../accounts/application/ports/pluggy-provider.port.js';
import type { ConnectionsCollectionEligibility } from '../../accounts/application/ports/connections.repository.port.js';
import type { PluggyConnectionLifecycle } from '../../accounts/application/use-cases/pluggy-connection-lifecycle.js';
import {
  PluggyActionRequired,
  PluggyUnavailable,
  PluggyUpdateDeferred,
} from '../../accounts/adapters/outbound/pluggy-api.client.js';
import type { QStashPluggyWebhookService } from '../../accounts/adapters/outbound/qstash-pluggy-webhook.service.js';
import type { ImportPluggyTransaction } from '../../transactions/application/use-cases/import-pluggy-transaction.js';
import {
  InvalidTransactionRequest,
  TransactionAccountArchived,
  TransactionAccountNotFound,
} from '../../transactions/application/transactions.errors.js';
import type { PluggySyncRepository } from './ports/pluggy-sync.repository.port.js';
import {
  toSyncRunView,
  type SyncJob,
  type SyncReason,
  type SyncRunView,
} from './pluggy-sync.types.js';
import { ConnectionNotFound } from '../../accounts/domain/connection.errors.js';

export class PluggySynchronization {
  constructor(
    private readonly repository: PluggySyncRepository,
    private readonly lifecycle: PluggyConnectionLifecycle,
    private readonly eligibility: ConnectionsCollectionEligibility,
    private readonly provider: PluggyProvider,
    private readonly importTransaction: ImportPluggyTransaction,
    private readonly queue: QStashPluggyWebhookService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async requestManual(
    context: TenantContext,
    connectionId: string,
  ): Promise<SyncRunView> {
    const { run, created } = await this.repository.createManual(
      context,
      connectionId,
    );
    if (!created) return toSyncRunView(run);
    try {
      await this.queue.publishSync({
        runId: run.id,
        tenantId: context.tenantId,
        userId: context.userId,
      });
    } catch (error: unknown) {
      await this.repository.finish(
        context,
        run.id,
        'failed',
        [{ dataType: 'connection', code: 'failed' }],
        null,
      );
      throw error;
    }
    return toSyncRunView(run);
  }

  async get(
    context: TenantContext,
    connectionId: string,
    runId: string,
  ): Promise<SyncRunView> {
    const run = await this.repository.findOwned(context, connectionId, runId);
    if (!run) throw new ConnectionNotFound();
    return toSyncRunView(run);
  }

  async latest(
    context: TenantContext,
    connectionId: string,
  ): Promise<{
    latest: SyncRunView | null;
    lastReconciled: SyncRunView | null;
  }> {
    const result = await this.repository.latestOwned(context, connectionId);
    if (!result) throw new ConnectionNotFound();
    return {
      latest: result.latest ? toSyncRunView(result.latest) : null,
      lastReconciled: result.lastReconciled
        ? toSyncRunView(result.lastReconciled)
        : null,
    };
  }

  async enqueueDaily(): Promise<void> {
    await this.repository.pruneExpiredRuns();
    const civilDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.now());
    for (const target of await this.repository.listDailyTargets()) {
      const run = await this.repository.createDaily(target, civilDate);
      if (!run) continue;
      await this.queue.publishSync({
        runId: run.id,
        tenantId: target.tenantId,
        userId: target.userId,
      });
    }
  }

  async processJob(job: SyncJob, retryCount: number): Promise<void> {
    const context = { tenantId: job.tenantId, userId: job.userId };
    const run = await this.repository.findJob(context, job.runId);
    if (!run) return;
    if (!['queued', 'running'].includes(run.status)) return;
    // shortcut: a worker taking over after ten minutes can overlap a very large sync; add a heartbeat when provider pagination can exceed this lease.
    if (!(await this.repository.claim(context, run.id))) return;

    try {
      const reference = await this.lifecycle.getCollectionReference(
        context,
        run.connectionId,
      );
      if (
        !reference ||
        !(await this.eligibility.canStartCollection(
          context,
          run.connectionId,
          randomUUID(),
        ))
      ) {
        await this.repository.finish(
          context,
          run.id,
          'action_required',
          [{ dataType: 'connection', code: 'unavailable' }],
          null,
        );
        return;
      }
      const item = await this.provider.getItem(reference.providerItemId);
      if (!item) {
        await this.repository.finish(
          context,
          run.id,
          'action_required',
          [{ dataType: 'connection', code: 'unavailable' }],
          null,
        );
        return;
      }
      if (requiresUserAction(item)) {
        await this.repository.finish(
          context,
          run.id,
          'action_required',
          [{ dataType: 'connection', code: 'unavailable' }],
          item.lastUpdatedAt ?? null,
        );
        return;
      }
      if (run.trigger === 'manual') {
        if (!run.updateRequestedAt) {
          try {
            const updated = await this.provider.updateItem(
              reference.providerItemId,
            );
            await this.repository.markUpdateRequested(context, run.id);
            if (
              updated.status !== 'UPDATED' &&
              updated.status !== 'PARTIAL_SUCCESS'
            )
              throw new PluggyUnavailable();
          } catch (error: unknown) {
            if (error instanceof PluggyActionRequired) {
              await this.repository.finish(
                context,
                run.id,
                'action_required',
                [{ dataType: 'connection', code: 'unavailable' }],
                null,
              );
              return;
            }
            if (error instanceof PluggyUpdateDeferred) {
              await this.repository.finish(
                context,
                run.id,
                'failed',
                [{ dataType: 'connection', code: 'failed' }],
                null,
              );
              return;
            }
            throw error;
          }
        } else if (
          item.status !== 'UPDATED' &&
          item.status !== 'PARTIAL_SUCCESS'
        ) {
          throw new PluggyUnavailable();
        }
      }

      const current = await this.provider.getItem(reference.providerItemId);
      if (!current) throw new PluggyUnavailable();
      if (requiresUserAction(current)) {
        await this.repository.finish(
          context,
          run.id,
          'action_required',
          [{ dataType: 'connection', code: 'unavailable' }],
          current.lastUpdatedAt ?? null,
        );
        return;
      }
      if (current.status !== 'UPDATED' && current.status !== 'PARTIAL_SUCCESS')
        throw new PluggyUnavailable();
      const reasons = await this.collect(
        context,
        run.connectionId,
        reference.providerItemId,
        (current.products ?? []).filter(
          (product) => !current.unavailableProducts?.includes(product),
        ),
        current.lastUpdatedAt ?? this.now(),
      );
      if (
        current.executionStatus === 'PARTIAL_SUCCESS' &&
        reasons.length === 0
      ) {
        reasons.push({ dataType: 'connection', code: 'unavailable' });
      }
      if (
        retryCount < 3 &&
        reasons.some((reason) => reason.code === 'failed')
      ) {
        throw new PluggyUnavailable();
      }
      await this.repository.finish(
        context,
        run.id,
        reasons.length ? 'partial' : 'succeeded',
        reasons,
        current.lastUpdatedAt ?? null,
      );
    } catch (error: unknown) {
      if (retryCount >= 3) {
        await this.repository.finish(
          context,
          run.id,
          'failed',
          [{ dataType: 'connection', code: 'failed' }],
          null,
        );
        return;
      }
      await this.repository.releaseRetry(context, run.id);
      throw error;
    }
  }

  private async collect(
    context: TenantContext,
    connectionId: string,
    itemId: string,
    itemProducts: readonly string[],
    referenceDate: Date,
  ): Promise<SyncReason[]> {
    const connection = await this.lifecycle.get(
      context,
      connectionId,
      randomUUID(),
    );
    const consented = new Set(connection.consent.products);
    const present = new Set(itemProducts);
    const reasons: SyncReason[] = [];
    const canReadAccounts =
      (consented.has('ACCOUNTS') && present.has('ACCOUNTS')) ||
      (consented.has('CREDIT_CARDS') && present.has('CREDIT_CARDS'));
    const mapped = await this.repository.mappedAccounts(context, connectionId);
    if (canReadAccounts) {
      let page = 1;
      let totalPages = 1;
      do {
        if (
          !(await this.eligibility.canStartCollection(
            context,
            connectionId,
            randomUUID(),
          ))
        ) {
          reasons.push({ dataType: 'accounts', code: 'unavailable' });
          break;
        }
        let result;
        try {
          result = await this.provider.listAccounts(itemId, page);
        } catch (error: unknown) {
          if (!(error instanceof PluggyUnavailable)) throw error;
          reasons.push({ dataType: 'accounts', code: 'failed' });
          break;
        }
        totalPages = result.totalPages;
        for (const account of result.accounts) {
          if (
            account.type === 'BANK' &&
            (!consented.has('ACCOUNTS') || !present.has('ACCOUNTS'))
          )
            continue;
          if (
            account.type === 'CREDIT' &&
            (!consented.has('CREDIT_CARDS') || !present.has('CREDIT_CARDS'))
          )
            continue;
          if (account.type !== 'BANK' && account.type !== 'CREDIT') continue;
          await this.repository.saveAccount(
            context,
            connectionId,
            account,
            referenceDate,
          );
          if (!consented.has('TRANSACTIONS') || !present.has('TRANSACTIONS'))
            continue;
          const localAccountId = mapped.get(account.id);
          if (!localAccountId) {
            reasons.push({ dataType: 'transactions', code: 'unavailable' });
            continue;
          }
          try {
            await this.collectTransactions(
              context,
              connectionId,
              account.id,
              localAccountId,
              reasons,
            );
          } catch (error: unknown) {
            if (!(error instanceof PluggyUnavailable)) throw error;
            reasons.push({ dataType: 'transactions', code: 'failed' });
          }
        }
        page += 1;
      } while (page <= totalPages);
    } else reasons.push({ dataType: 'accounts', code: 'unavailable' });
    if (!consented.has('TRANSACTIONS') || !present.has('TRANSACTIONS')) {
      reasons.push({ dataType: 'transactions', code: 'unavailable' });
    }

    const canReadInvestments = [
      'INVESTMENTS',
      'INVESTMENTS_TRANSACTIONS',
    ].every((product) => consented.has(product) && present.has(product));
    if (!canReadInvestments) {
      reasons.push({ dataType: 'investments', code: 'unavailable' });
      reasons.push({
        dataType: 'investment_transactions',
        code: 'unavailable',
      });
    } else {
      let page = 1;
      let totalPages = 1;
      do {
        if (
          !(await this.eligibility.canStartCollection(
            context,
            connectionId,
            randomUUID(),
          ))
        ) {
          reasons.push({ dataType: 'investments', code: 'unavailable' });
          break;
        }
        let result;
        try {
          result = await this.provider.listInvestments(itemId, page);
        } catch (error: unknown) {
          if (!(error instanceof PluggyUnavailable)) throw error;
          reasons.push({ dataType: 'investments', code: 'failed' });
          reasons.push({ dataType: 'investment_transactions', code: 'failed' });
          break;
        }
        totalPages = result.totalPages;
        for (const investment of result.investments) {
          const investmentId = await this.repository.saveInvestment(
            context,
            connectionId,
            investment,
          );
          try {
            await this.collectInvestmentMovements(
              context,
              connectionId,
              investmentId,
              investment,
              reasons,
            );
          } catch (error: unknown) {
            if (!(error instanceof PluggyUnavailable)) throw error;
            reasons.push({
              dataType: 'investment_transactions',
              code: 'failed',
            });
          }
        }
        page += 1;
      } while (page <= totalPages);
    }
    return [
      ...new Map(
        reasons.map((reason) => [`${reason.dataType}:${reason.code}`, reason]),
      ).values(),
    ];
  }

  private async collectTransactions(
    context: TenantContext,
    connectionId: string,
    providerAccountId: string,
    accountId: string,
    reasons: SyncReason[],
  ): Promise<void> {
    let next: string | null = null;
    const seen = new Set<string>();
    do {
      if (
        !(await this.eligibility.canStartCollection(
          context,
          connectionId,
          randomUUID(),
        ))
      ) {
        reasons.push({ dataType: 'transactions', code: 'unavailable' });
        return;
      }
      const page = await this.provider.listTransactions(
        providerAccountId,
        next,
      );
      for (const transaction of page.transactions) {
        if (
          transaction.accountId !== providerAccountId ||
          transaction.status !== 'POSTED'
        )
          continue;
        if (transaction.currencyCode !== 'BRL') {
          reasons.push({ dataType: 'transactions', code: 'unavailable' });
          continue;
        }
        try {
          const result = await this.importTransaction.execute(context, {
            connectionId,
            accountId,
            providerAccountId,
            providerTransactionId: transaction.id,
            currencyCode: transaction.currencyCode,
            type: transaction.type === 'CREDIT' ? 'income' : 'expense',
            amount: transaction.amount,
            occurredOn: transaction.date.slice(0, 10),
            description: transaction.description,
          });
          if (result.disposition === 'ambiguous')
            reasons.push({
              dataType: 'transactions',
              code: 'ambiguous_identity',
            });
        } catch (error: unknown) {
          if (
            error instanceof InvalidTransactionRequest ||
            error instanceof TransactionAccountArchived ||
            error instanceof TransactionAccountNotFound
          ) {
            reasons.push({ dataType: 'transactions', code: 'failed' });
            continue;
          }
          throw error;
        }
      }
      if (page.next && seen.has(page.next)) throw new PluggyUnavailable();
      if (page.next) seen.add(page.next);
      next = page.next;
    } while (next);
  }

  private async collectInvestmentMovements(
    context: TenantContext,
    connectionId: string,
    investmentId: string,
    investment: PluggyInvestmentSnapshot,
    reasons: SyncReason[],
  ): Promise<void> {
    let page = 1;
    let totalPages = 1;
    do {
      if (
        !(await this.eligibility.canStartCollection(
          context,
          connectionId,
          randomUUID(),
        ))
      ) {
        reasons.push({
          dataType: 'investment_transactions',
          code: 'unavailable',
        });
        return;
      }
      const result = await this.provider.listInvestmentMovements(
        investment.id,
        page,
      );
      totalPages = result.totalPages;
      for (const movement of result.movements) {
        await this.repository.saveMovement(
          context,
          connectionId,
          investmentId,
          movement,
        );
      }
      page += 1;
    } while (page <= totalPages);
  }
}

function requiresUserAction(item: PluggyItemSnapshot): boolean {
  return (
    Boolean(item.userAction) ||
    [
      'WAITING_USER_INPUT',
      'WAITING_USER_ACTION',
      'USER_AUTHORIZATION_PENDING',
      'LOGIN_ERROR',
    ].includes(item.status) ||
    [
      'WAITING_USER_INPUT',
      'WAITING_USER_ACTION',
      'USER_AUTHORIZATION_PENDING',
    ].includes(item.executionStatus)
  );
}
