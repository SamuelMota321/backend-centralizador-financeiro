import { describe, expect, it, vi } from 'vitest';
import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditRecord } from '../../../audit/application/audit-record.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import type { AccountSnapshot } from '../../domain/account.js';
import type { AccountView } from '../account-view.js';
import { AccountHasActiveCategoryRules } from '../accounts.errors.js';
import type {
  AccountMaintenanceScope,
  TenantAccountsRepository,
} from '../ports/accounts.repository.port.js';
import { DeactivateAccount } from './deactivate-account.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};
const accountId = '164aa078-983d-4c39-aae4-dda44b495970';
const requestId = '264aa078-983d-4c39-aae4-dda44b495970';
const view: AccountView = {
  id: accountId,
  name: 'Conta',
  type: 'checking',
  origin: 'manual',
  institutionName: null,
  initialBalance: '10.00',
  initialBalanceAsOf: '2026-09-01',
  currencyCode: 'BRL',
  archivedAt: '2026-09-11T12:00:00.000Z',
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-11T12:00:00.000Z',
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

function harness(current: AccountSnapshot) {
  const deactivate = vi.fn(() => Promise.resolve(view));
  const write = vi.fn((record: AuditRecord) => {
    void record;
    return Promise.resolve();
  });
  const accounts: TenantAccountsRepository = {
    findPossibleConnectedDuplicates: vi.fn(() => Promise.resolve([])),
    createManual: vi.fn(() => Promise.resolve(view)),
    countActive: vi.fn(() => Promise.resolve(0)),
    findActive: vi.fn(() => Promise.resolve([])),
    findByIdForUpdate: vi.fn(() => Promise.resolve(current)),
    update: vi.fn(() => Promise.resolve(view)),
    deactivate,
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
  return { accounts, audit, unitOfWork, deactivate, write };
}

describe('DeactivateAccount', () => {
  it('archives an active account and records the transition', async () => {
    const { unitOfWork, deactivate, write } = harness(snapshot);

    await expect(
      new DeactivateAccount(unitOfWork).execute(context, accountId, requestId),
    ).resolves.toEqual(view);
    expect(deactivate).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      props: {
        action: 'account_deactivated',
        metadata: { stateTransition: 'active_to_archived' },
        requestId,
      },
    } satisfies Partial<{ props: Partial<AuditRecord['props']> }>);
  });

  it('is idempotent and records already_archived', async () => {
    const { write, unitOfWork } = harness({
      ...snapshot,
      archivedAt: '2026-09-10T12:00:00.000Z',
    });

    await expect(
      new DeactivateAccount(unitOfWork).execute(context, accountId, requestId),
    ).resolves.toEqual(view);
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      props: { metadata: { stateTransition: 'already_archived' } },
    });
  });

  it('does not record account archival when active category rules block it', async () => {
    const { unitOfWork, deactivate, write } = harness(snapshot);
    const conflict = new AccountHasActiveCategoryRules();
    deactivate.mockRejectedValue(conflict);

    await expect(
      new DeactivateAccount(unitOfWork).execute(context, accountId, requestId),
    ).rejects.toBe(conflict);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not commit a successful result when audit writing fails', async () => {
    const error = new Error('audit failure');
    const deactivate = vi.fn(() => Promise.resolve(view));
    const write = vi.fn((record: AuditRecord) => {
      void record;
      return Promise.reject(error);
    });
    const accounts: TenantAccountsRepository = {
      findPossibleConnectedDuplicates: vi.fn(() => Promise.resolve([])),
      createManual: vi.fn(() => Promise.resolve(view)),
      countActive: vi.fn(() => Promise.resolve(0)),
      findActive: vi.fn(() => Promise.resolve([])),
      findByIdForUpdate: vi.fn(() => Promise.resolve(snapshot)),
      update: vi.fn(() => Promise.resolve(view)),
      deactivate,
    };
    const audit: AuditWriter = { write };
    const unitOfWork: TenantUnitOfWork<AccountMaintenanceScope> = {
      run<Result>(
        _context: TenantContext,
        operation: (scope: AccountMaintenanceScope) => Promise<Result>,
      ): Promise<Result> {
        return operation({ accounts, audit });
      },
    };

    await expect(
      new DeactivateAccount(unitOfWork).execute(context, accountId, requestId),
    ).rejects.toBe(error);
    expect(deactivate).toHaveBeenCalledOnce();
  });
});
