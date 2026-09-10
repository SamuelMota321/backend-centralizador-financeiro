import { describe, expect, it } from 'vitest';
import {
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
});
