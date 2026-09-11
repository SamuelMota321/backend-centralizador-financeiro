import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AccountView } from '../account-view.js';
import type {
  AccountsRepository,
  TenantAccountsRepository,
} from '../ports/accounts.repository.port.js';
import { ListAccounts } from './list-accounts.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};

const item: AccountView = {
  id: '164aa078-983d-4c39-aae4-dda44b495970',
  name: 'Dinheiro',
  type: 'cash',
  origin: 'manual',
  institutionName: null,
  initialBalance: '0.00',
  initialBalanceAsOf: '2026-09-01',
  currencyCode: 'BRL',
  archivedAt: null,
  createdAt: '2026-09-10T12:00:00.000Z',
  updatedAt: '2026-09-10T12:00:00.000Z',
};

function repositoryWith(total: number, items: AccountView[]) {
  const findActive = vi.fn(() => Promise.resolve(items));
  const tenantRepository: TenantAccountsRepository = {
    findPossibleConnectedDuplicates: vi.fn(() => Promise.resolve([])),
    createManual: vi.fn(() => Promise.resolve(item)),
    countActive: vi.fn(() => Promise.resolve(total)),
    findActive,
    findByIdForUpdate: vi.fn(() => Promise.resolve(null)),
    update: vi.fn(() => Promise.resolve(item)),
    deactivate: vi.fn(() => Promise.resolve(item)),
  };
  const repository: AccountsRepository = {
    withTenant: async (_context, operation) => operation(tenantRepository),
  };
  return { repository, tenantRepository, findActive };
}

describe('ListAccounts', () => {
  it('returns the requested page and total', async () => {
    const { repository, findActive } = repositoryWith(21, [item]);
    const result = await new ListAccounts(repository).execute(context, {
      page: 2,
      pageSize: 20,
    });

    expect(result).toEqual({ items: [item], page: 2, pageSize: 20, total: 21 });
    expect(findActive).toHaveBeenCalledWith(20, 20);
  });

  it('does not send an unsafe offset to Prisma for a page beyond the total', async () => {
    const { repository, findActive } = repositoryWith(1, []);
    const result = await new ListAccounts(repository).execute(context, {
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 100,
    });

    expect(result.items).toEqual([]);
    expect(findActive).not.toHaveBeenCalled();
  });
});
