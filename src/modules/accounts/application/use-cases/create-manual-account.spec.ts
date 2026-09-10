import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AccountView, DuplicateCandidate } from '../account-view.js';
import { PossibleConnectedAccountDuplicate } from '../accounts.errors.js';
import type {
  AccountsRepository,
  TenantAccountsRepository,
} from '../ports/accounts.repository.port.js';
import { CreateManualAccount } from './create-manual-account.js';

const context: TenantContext = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};

const view: AccountView = {
  id: '164aa078-983d-4c39-aae4-dda44b495970',
  name: 'Conta Principal',
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

const input = {
  name: 'Conta Principal',
  type: 'checking',
  institutionName: 'Banco',
  initialBalance: '10.50',
  initialBalanceAsOf: '2026-09-01',
  confirmPossibleDuplicate: false,
};

function createRepository(candidates: DuplicateCandidate[] = []) {
  const findPossibleConnectedDuplicates = vi.fn(() =>
    Promise.resolve(candidates),
  );
  const createManual = vi.fn(() => Promise.resolve(view));
  const tenantRepository: TenantAccountsRepository = {
    findPossibleConnectedDuplicates,
    createManual,
    countActive: vi.fn(() => Promise.resolve(0)),
    findActive: vi.fn(() => Promise.resolve([])),
  };
  const repository: AccountsRepository = {
    withTenant: async (_context, operation) => operation(tenantRepository),
  };
  return {
    repository,
    tenantRepository,
    spies: { createManual, findPossibleConnectedDuplicates },
  };
}

describe('CreateManualAccount', () => {
  it('creates a manual account under the authenticated tenant', async () => {
    const { repository, spies } = createRepository();
    const useCase = new CreateManualAccount(repository);

    await expect(useCase.execute(context, input)).resolves.toEqual(view);
    expect(spies.createManual).toHaveBeenCalledOnce();
  });

  it('requires confirmation before a possible connected duplicate', async () => {
    const candidate: DuplicateCandidate = {
      id: '61ee4c7a-94eb-40d7-87bc-dc050130dd3e',
      name: 'Conta Principal',
      type: 'checking',
      origin: 'connected',
      institutionName: 'Banco',
    };
    const { repository, spies } = createRepository([candidate]);
    const useCase = new CreateManualAccount(repository);

    await expect(useCase.execute(context, input)).rejects.toMatchObject({
      name: 'PossibleConnectedAccountDuplicate',
      candidates: [candidate],
    });
    expect(spies.createManual).not.toHaveBeenCalled();
  });

  it('creates a separate manual account after explicit confirmation', async () => {
    const candidate: DuplicateCandidate = {
      id: '61ee4c7a-94eb-40d7-87bc-dc050130dd3e',
      name: 'Conta Principal',
      type: 'checking',
      origin: 'connected',
      institutionName: 'Banco',
    };
    const { repository, spies } = createRepository([candidate]);
    const useCase = new CreateManualAccount(repository);

    await expect(
      useCase.execute(context, { ...input, confirmPossibleDuplicate: true }),
    ).resolves.toEqual(view);
    expect(spies.createManual).toHaveBeenCalledOnce();
  });

  it('uses the typed duplicate error', () => {
    expect(new PossibleConnectedAccountDuplicate([])).toBeInstanceOf(Error);
  });
});
