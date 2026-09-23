import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Transaction } from './transaction.js';
import {
  InvalidTransactionAmount,
  InvalidTransactionState,
  TransactionCategorizationNotAllowed,
} from './transactions.errors.js';

const tenantId = randomUUID();
const accountId = randomUUID();
const categoryId = randomUUID();

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
      transferId: randomUUID(),
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
      id: randomUUID(),
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
      transferId: randomUUID(),
      transferSide: 'incoming',
    });
    expect(() =>
      transfer.categorize(categoryId, 'manual', '2026-09-20T10:00:00.000Z'),
    ).toThrow(TransactionCategorizationNotAllowed);
  });

  it('keeps uncertain and unrecognized categorization explicit', () => {
    const transaction = Transaction.createManual({
      tenantId,
      accountId,
      type: 'expense',
      amount: '8.00',
      occurredOn: '2026-09-20',
    });

    const uncertain = transaction.markUncertain(
      'uncertain',
      '2026-09-20T10:01:00.000Z',
    );
    const unrecognized = uncertain.markUncertain(
      'unrecognized',
      '2026-09-20T10:02:00.000Z',
    );

    expect(uncertain.props).toMatchObject({
      categoryId: null,
      categorizationStatus: 'uncertain',
      categorizationSource: null,
    });
    expect(unrecognized.props.categorizationStatus).toBe('unrecognized');
  });
});
