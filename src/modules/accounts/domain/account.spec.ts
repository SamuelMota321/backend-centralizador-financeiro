import { describe, expect, it } from 'vitest';
import {
  AccountArchived,
  BalanceReferencePairRequired,
  ConnectedAccountReadOnly,
  InvalidAccountName,
  InvalidBalanceReferenceDate,
  InvalidInstitution,
} from './account.errors.js';
import { Account } from './account.js';

describe('Account', () => {
  it('normalizes a valid manual account without binary money', () => {
    const account = Account.createManual(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        name: '  Conta\u00a0Principal  ',
        type: 'checking',
        institutionName: '  Banco   Exemplo ',
        initialBalance: '-10.25',
        initialBalanceAsOf: '2026-09-08',
      },
      '2026-09-09',
    );

    expect(account.props.name).toBe('Conta Principal');
    expect(account.props.institutionName).toBe('Banco Exemplo');
    expect(account.props.initialBalance.amountInCents).toBe(-1025n);
    expect(account.props.origin).toBe('manual');
    expect(account.props.externalProvider).toBeNull();
  });

  it('converts a blank institution to null', () => {
    const account = Account.createManual(
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        name: 'Carteira',
        type: 'cash',
        institutionName: '   ',
        initialBalance: '0',
        initialBalanceAsOf: '2026-09-09',
      },
      '2026-09-09',
    );
    expect(account.props.institutionName).toBeNull();
  });

  it('rejects control characters in a name', () => {
    expect(() =>
      Account.createManual(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          name: 'Conta\nOculta',
          type: 'checking',
          initialBalance: '0',
          initialBalanceAsOf: '2026-09-09',
        },
        '2026-09-09',
      ),
    ).toThrow(InvalidAccountName);
  });

  it('rejects an institution containing only control whitespace', () => {
    expect(() =>
      Account.createManual(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          name: 'Conta',
          type: 'checking',
          institutionName: '\n\t',
          initialBalance: '0',
          initialBalanceAsOf: '2026-09-09',
        },
        '2026-09-09',
      ),
    ).toThrow(InvalidInstitution);
  });

  it('rejects a future balance reference date', () => {
    expect(() =>
      Account.createManual(
        {
          tenantId: '11111111-1111-4111-8111-111111111111',
          name: 'Conta',
          type: 'checking',
          initialBalance: '0',
          initialBalanceAsOf: '2026-09-10',
        },
        '2026-09-09',
      ),
    ).toThrow(InvalidBalanceReferenceDate);
  });

  it('updates a reconstituted manual account using normalized values', () => {
    const account = Account.reconstitute({
      id: '164aa078-983d-4c39-aae4-dda44b495970',
      tenantId: '11111111-1111-4111-8111-111111111111',
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
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    const updated = account.update({
      name: '  Conta   Atualizada ',
      institutionName: '',
      initialBalance: '-2.50',
      initialBalanceAsOf: '2026-09-02',
    });

    expect(updated.props).toMatchObject({
      name: 'Conta Atualizada',
      institutionName: null,
    });
    expect(updated.props.initialBalance.toDecimal()).toBe('-2.50');
    expect(updated.props.initialBalanceAsOf.value).toBe('2026-09-02');
  });

  it('rejects updates to archived and connected accounts', () => {
    const base = {
      id: '164aa078-983d-4c39-aae4-dda44b495970',
      tenantId: '11111111-1111-4111-8111-111111111111',
      name: 'Conta',
      type: 'checking' as const,
      institutionName: null,
      initialBalance: '10.00',
      initialBalanceAsOf: '2026-09-01',
      currencyCode: 'BRL' as const,
      archivedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const archived = Account.reconstitute({
      ...base,
      origin: 'manual',
      externalProvider: null,
      externalAccountId: null,
      archivedAt: '2026-09-02T00:00:00.000Z',
    });
    const connected = Account.reconstitute({
      ...base,
      origin: 'connected',
      externalProvider: 'pluggy',
      externalAccountId: 'external-id',
    });

    expect(() => archived.update({ name: 'Outra' })).toThrow(AccountArchived);
    expect(() => connected.update({ name: 'Outra' })).toThrow(
      ConnectedAccountReadOnly,
    );
  });

  it('requires balance and reference date to be updated together', () => {
    const account = Account.reconstitute({
      id: '164aa078-983d-4c39-aae4-dda44b495970',
      tenantId: '11111111-1111-4111-8111-111111111111',
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
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    expect(() => account.update({ initialBalance: '20.00' })).toThrow(
      BalanceReferencePairRequired,
    );
  });
});
