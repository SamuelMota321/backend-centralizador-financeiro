import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';
import {
  toTransactionView,
  type TransactionPage,
} from '../transactions-view.js';

export type ListTransactionsInput = Readonly<{
  page: number;
  pageSize: number;
}>;

export class ListTransactions {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    input: ListTransactionsInput,
  ): Promise<TransactionPage> {
    assertTenantContext(context);
    const offset = (input.page - 1) * input.pageSize;
    return this.transactions.withTenant(context, async ({ transactions }) => {
      const [total, snapshots] = await Promise.all([
        transactions.count(),
        transactions.findPage(offset, input.pageSize),
      ]);
      return {
        items: snapshots.map(toTransactionView),
        page: input.page,
        pageSize: input.pageSize,
        total,
      };
    });
  }
}
