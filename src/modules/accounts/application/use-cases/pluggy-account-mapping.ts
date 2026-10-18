import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AccountView } from '../account-view.js';
import type { AccountMaintenanceScope } from '../ports/accounts.repository.port.js';
import { canStartConnectionCollection } from '../../domain/connection.js';
import { Account } from '../../domain/account.js';
import { AccountNotFound } from '../../domain/account.errors.js';
import {
  ConnectionNotFound,
  ConnectionRequestConflict,
} from '../../domain/connection.errors.js';

export type PluggyAccountMappingInput = Readonly<{
  connectionId: string;
  providerAccountId: string;
  name: string;
  type: 'checking' | 'savings' | 'credit_card';
  balance: string;
  balanceAsOf: string;
}>;

export class CreatePluggyConnectedAccount {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    context: TenantContext,
    input: PluggyAccountMappingInput,
    requestId: string,
  ): Promise<AccountView> {
    assertTenantContext(context);
    return this.unitOfWork.run(
      context,
      async ({ accounts, connections, audit }) => {
        const connection = await connections.findOwnedById(
          input.connectionId,
          context.userId,
        );
        if (!connection?.providerItemId) throw new ConnectionNotFound();
        if (!canStartConnectionCollection(connection, this.now())) {
          throw new ConnectionRequestConflict();
        }

        const existing = await accounts.findByExternalIdentity(
          'pluggy',
          input.providerAccountId,
        );
        if (existing) return existing;

        const account = Account.createConnected({
          tenantId: context.tenantId,
          name: input.name,
          type: input.type,
          initialBalance: input.balance,
          initialBalanceAsOf: input.balanceAsOf,
          externalProvider: 'pluggy',
          externalAccountId: input.providerAccountId,
        });
        const result = await accounts.createConnected(account);
        if (result.created) {
          await audit.write(
            AuditRecord.create({
              tenantId: context.tenantId,
              actorUserId: context.userId,
              action: 'connection_lifecycle_updated',
              resourceType: 'connection',
              resourceId: connection.id,
              outcome: 'success',
              requestId,
              metadata: { stateTransition: 'pluggy_account_created' },
            }),
          );
        }
        return result.account;
      },
    );
  }
}

export class AssociatePluggyAccount {
  constructor(
    private readonly unitOfWork: TenantUnitOfWork<AccountMaintenanceScope>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    context: TenantContext,
    input: Readonly<{
      connectionId: string;
      accountId: string;
      providerAccountId: string;
    }>,
    requestId: string,
  ): Promise<AccountView> {
    assertTenantContext(context);
    return this.unitOfWork.run(
      context,
      async ({ accounts, connections, audit }) => {
        const connection = await connections.findOwnedById(
          input.connectionId,
          context.userId,
        );
        if (!connection?.providerItemId) throw new ConnectionNotFound();
        if (!canStartConnectionCollection(connection, this.now())) {
          throw new ConnectionRequestConflict();
        }

        const existing = await accounts.findByExternalIdentity(
          'pluggy',
          input.providerAccountId,
        );
        if (existing) {
          if (existing.id !== input.accountId)
            throw new ConnectionRequestConflict();
          return existing;
        }

        const associated = await accounts.associatePluggyAccount(
          input.accountId,
          input.providerAccountId,
        );
        if (associated.archivedAt !== null) throw new AccountNotFound();
        await audit.write(
          AuditRecord.create({
            tenantId: context.tenantId,
            actorUserId: context.userId,
            action: 'connection_lifecycle_updated',
            resourceType: 'connection',
            resourceId: connection.id,
            outcome: 'success',
            requestId,
            metadata: { stateTransition: 'pluggy_account_linked' },
          }),
        );
        return associated;
      },
    );
  }
}
