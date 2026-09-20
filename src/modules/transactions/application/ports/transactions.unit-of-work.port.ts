import type { TenantUnitOfWork } from '../../../../shared/application/ports/tenant-unit-of-work.port.js';
import type { TransactionPersistenceScope } from './transactions.repository.port.js';

export const TRANSACTIONS_UNIT_OF_WORK = Symbol('TRANSACTIONS_UNIT_OF_WORK');

export type TransactionsUnitOfWork =
  TenantUnitOfWork<TransactionPersistenceScope>;
