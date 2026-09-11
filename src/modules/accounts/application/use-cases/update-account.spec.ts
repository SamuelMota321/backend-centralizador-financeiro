import { describe, expect, it, vi } from 'vitest';
import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import {
  AccountArchived,
  ConnectedAccountReadOnly,
} from '../../domain/account.errors.js';
import type { AccountSnapshot } from '../../domain/account.js';
import type { AccountView, DuplicateCandidate } from '../account-view.js';
import { PossibleConnectedAccountDuplicate } from '../accounts.errors.js';
import type {
  AccountMaintenanceScope,
  TenantAccountsRepository,
} from '../ports/accounts.repository.port.js';
import { UpdateAccount } from './update-account.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const accountId = '164aa078-983d-4c39-aae4-dda44b495970';
const requestId = '264aa078-983d-4c39-aae4-dda44b495970';
const view: AccountView = {
  id: accountId,
  name: 'Conta Atualizada',
  type: 'checking',
  origin: 'manual',
  institutionName: 'Banco',
  initialBalance: '10.50',
  initialBalanceAsOf: '2026-09-01',
  currencyCode: 'BRL',
  archivedAt: null,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};
const snapshot: AccountSnapshot = {
  id: accountId,
  tenantId: context.tenantId,
  name: 'Conta',
  type: 'checking',
  origin: 'manual',
  institutionName: null,
  initialBalance: '10.00',
  initialBalanceAsOf: '2026-09-01',
  currencyCode: 'BRL',
  externalProvider: null,
  externalAccountId: null,
  archivedAt: null,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

function harness(
  current: AccountSnapshot = snapshot,
  candidates: DuplicateCandidate[] = [],
) {
  const findPossibleConnectedDuplicates = vi.fn(() =>
    Promise.resolve(candidates),
  );
  const update = vi.fn(() => Promise.resolve(view));
  const write = vi.fn((record: AuditRecord) => {
    void record;
    return Promise.resolve();
  });
  const accounts: TenantAccountsRepository = {
    findPossibleConnectedDuplicates,
    createManual: vi.fn(() => Promise.resolve(view)),
    countActive: vi.fn(() => Promise.resolve(0)),
    findActive: vi.fn(() => Promise.resolve([])),
    findByIdForUpdate: vi.fn(() => Promise.resolve(current)),
    update,
    deactivate: vi.fn(() => Promise.resolve(view)),
  };
  const audit: AuditWriter = { write };
  const scope: AccountMaintenanceScope = { accounts, audit };
  const unitOfWork: TenantUnitOfWork<AccountMaintenanceScope> = {
    run<Result>(
      _context: TenantContext,
      operation: (scope: AccountMaintenanceScope) => Promise<Result>,
    ): Promise<Result> {
      return operation(scope);
    },
  };
  return {
    accounts,
    audit,
    unitOfWork,
    findPossibleConnectedDuplicates,
    update,
    write,
  };
}

describe('UpdateAccount', () => {
  it('updates an owned manual account and writes minimal audit metadata', async () => {
    const { unitOfWork, update, write } = harness();

    await expect(
      new UpdateAccount(unitOfWork).execute(context, accountId, requestId, {
        name: 'Conta Atualizada',
        confirmPossibleDuplicate: false,
      }),
    ).resolves.toEqual(view);

    expect(update).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      props: {
        tenantId: context.tenantId,
        actorUserId: context.userId,
        resourceId: accountId,
        requestId,
        action: 'account_updated',
        metadata: { changedFields: ['name'] },
      },
    } satisfies Partial<{ props: Partial<AuditRecord['props']> }>);
  });

  it('requires duplicate confirmation only when identity fields are supplied', async () => {
    const candidate: DuplicateCandidate = {
      id: '61ee4c7a-94eb-40d7-87bc-dc050130dd3e',
      name: 'Connected',
      type: 'checking',
      origin: 'connected',
      institutionName: 'Banco',
    };
    const { update, write, findPossibleConnectedDuplicates, unitOfWork } =
      harness(snapshot, [candidate]);

    await expect(
      new UpdateAccount(unitOfWork).execute(context, accountId, requestId, {
        name: 'Connected',
        confirmPossibleDuplicate: false,
      }),
    ).rejects.toBeInstanceOf(PossibleConnectedAccountDuplicate);
    expect(update).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    await expect(
      new UpdateAccount(unitOfWork).execute(context, accountId, requestId, {
        initialBalance: '12.00',
        initialBalanceAsOf: '2026-09-02',
        confirmPossibleDuplicate: false,
      }),
    ).resolves.toEqual(view);
    expect(findPossibleConnectedDuplicates).toHaveBeenCalledOnce();
  });

  it('uses archived precedence for an archived connected account', async () => {
    const { unitOfWork } = harness({
      ...snapshot,
      origin: 'connected',
      externalProvider: 'pluggy',
      externalAccountId: 'external-id',
      archivedAt: '2026-09-02T00:00:00.000Z',
    });

    await expect(
      new UpdateAccount(unitOfWork).execute(context, accountId, requestId, {
        name: 'Outra',
        confirmPossibleDuplicate: false,
      }),
    ).rejects.toBeInstanceOf(AccountArchived);
  });

  it('rejects updates to an active connected account', async () => {
    const { unitOfWork } = harness({
      ...snapshot,
      origin: 'connected',
      externalProvider: 'pluggy',
      externalAccountId: 'external-id',
    });

    await expect(
      new UpdateAccount(unitOfWork).execute(context, accountId, requestId, {
        name: 'Outra',
        confirmPossibleDuplicate: false,
      }),
    ).rejects.toBeInstanceOf(ConnectedAccountReadOnly);
  });
});
