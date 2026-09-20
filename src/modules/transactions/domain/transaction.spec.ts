import { describe, expect, it } from 'vitest';
import { Transaction } from './transaction.js';
import {
  InvalidTransactionAmount,
  InvalidTransactionState,
  TransactionCategorizationNotAllowed,
} from './transactions.errors.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';

describe('Transaction', () => {
  it('creates a positive manual income without binary money', () => {
    const transaction = Transaction.createManual({
      tenantId,
      accountId,
      type: 'income',
      amount: '10.5',
      occurredOn: '2026-09-20',
      description: '  Salário\n mensal ',
    });

    expect(transaction.props.amount.toDecimal()).toBe('10.50');
    expect(transaction.props.description).toBe('Salário mensal');
    expect(transaction.props.status).toBe('posted');
    expect(transaction.props.categorizationStatus).toBe('unclassified');
  });

  it('rejects zero and negative amounts', () => {
    expect(() =>
      Transaction.createManual({
        tenantId,
        accountId,
        type: 'expense',
        amount: '0',
        occurredOn: '2026-09-20',
      }),
    ).toThrow(InvalidTransactionAmount);

    expect(() =>
      Transaction.createManual({
        tenantId,
        accountId,
        type: 'expense',
        amount: '-1.00',
        occurredOn: '2026-09-20',
      }),
    ).toThrow(InvalidTransactionAmount);
  });

  it('creates a transfer entry with an uncategorizable side', () => {
    const transaction = Transaction.createTransferEntry({
      tenantId,
      accountId,
      amount: '100.00',
      occurredOn: '2026-09-20',
      transferId: '44444444-4444-4444-8444-444444444444',
      transferSide: 'outgoing',
    });

    expect(transaction.props).toMatchObject({
      type: 'transfer',
      transferSide: 'outgoing',
      categoryId: null,
      categorizationStatus: 'not_applicable',
    });
  });

  it('categorizes a posted manual transaction and voids it', () => {
    const transaction = Transaction.reconstitute({
      id: '55555555-5555-4555-8555-555555555555',
      tenantId,
      accountId,
      type: 'expense',
      amount: '12.34',
      occurredOn: '2026-09-20',
      description: 'Mercado',
      status: 'posted',
      transferId: null,
      transferSide: null,
      categoryId: null,
      categorizationStatus: 'unclassified',
      categorizationSource: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    });

    const categorized = transaction.categorize(
      categoryId,
      'manual',
      '2026-09-20T10:01:00.000Z',
    );
    expect(categorized.props).toMatchObject({
      categoryId,
      categorizationStatus: 'categorized',
      categorizationSource: 'manual',
    });
    expect(categorized.void('2026-09-20T10:02:00.000Z').props.status).toBe(
      'voided',
    );
  });

  it('does not allow transfer categorization or transfer creation through the manual type', () => {
    expect(() =>
      Transaction.createManual({
        tenantId,
        accountId,
        type: 'transfer',
        amount: '1.00',
        occurredOn: '2026-09-20',
      }),
    ).toThrow(InvalidTransactionState);

    const transfer = Transaction.createTransferEntry({
      tenantId,
      accountId,
      amount: '1.00',
      occurredOn: '2026-09-20',
      transferId: '66666666-6666-4666-8666-666666666666',
      transferSide: 'incoming',
    });
    expect(() =>
      transfer.categorize(categoryId, 'manual', '2026-09-20T10:00:00.000Z'),
    ).toThrow(TransactionCategorizationNotAllowed);
  });
});
