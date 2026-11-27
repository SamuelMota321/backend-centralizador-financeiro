import { randomUUID } from 'node:crypto';
import {
  assertTenantContext,
  type TenantContext,
} from '../../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../../audit/application/audit-record.js';
import { CategoryRule } from '../../domain/category-rule.js';
import { Transaction } from '../../domain/transaction.js';
import {
  CategoryRuleNotFound,
  CategoryRuleRemoved,
} from '../../domain/transactions.errors.js';
import {
  CategoryArchived,
  CategoryNotFound,
  InvalidTransactionRequest,
} from '../transactions.errors.js';
import type { TransactionsRepository } from '../ports/transactions.repository.port.js';

/** Linhas lidas e gravadas por transacao do banco (que tem tempo maximo). */
const CHUNK_SIZE = 100;
/** Teto do periodo, para o pedido nao virar uma varredura sem fim. */
const MAX_PERIOD_DAYS = 800;
const MAX_EXAMINED = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ApplyCategoryRuleInput = Readonly<{ from: string; to: string }>;

export type ApplyCategoryRuleResult = Readonly<{
  ruleId: string;
  from: string;
  to: string;
  /** Movimentacoes sem classificacao no periodo que a regra avaliou. */
  examined: number;
  /** Quantas receberam a categoria da regra. */
  categorized: number;
  /** Verdadeiro se parou no teto de linhas: aplicar de novo continua de onde parou. */
  truncated: boolean;
}>;

/**
 * Aplica UMA regra as movimentacoes que ja existem, num periodo. Nunca troca categoria que ja
 * esta definida (manual ou por regra): so mexe no que esta sem classificacao. Pode ser repetida
 * sem efeito colateral: a segunda vez encontra menos linhas ou nenhuma.
 */
export class ApplyCategoryRule {
  constructor(private readonly transactions: TransactionsRepository) {}

  async execute(
    context: TenantContext,
    ruleId: string,
    input: ApplyCategoryRuleInput,
    requestId: string = randomUUID(),
  ): Promise<ApplyCategoryRuleResult> {
    assertTenantContext(context);
    assertPeriod(input);

    const rule = await this.loadApplicableRule(context, ruleId);
    let afterId: string | null = null;
    let examined = 0;
    let categorized = 0;
    let truncated = false;

    for (;;) {
      const chunk = await this.transactions.withTenant(context, async (scope) => {
        const candidates = await scope.transactions.findUnclassifiedInPeriod({
          from: input.from,
          to: input.to,
          afterId,
          limit: CHUNK_SIZE,
        });
        const matching = candidates.filter((snapshot) =>
          rule.matches(Transaction.reconstitute(snapshot)),
        );
        const changed = await scope.transactions.categorizeByRule(
          matching.map((snapshot) => snapshot.id),
          rule.props.categoryId,
        );
        if (changed > 0) {
          for (const snapshot of matching) {
            await scope.audit.write(
              AuditRecord.create({
                tenantId: context.tenantId,
                actorUserId: context.userId,
                action: 'transaction_category_updated',
                resourceType: 'transaction',
                resourceId: snapshot.id,
                outcome: 'success',
                requestId,
                metadata: {
                  changedFields: [
                    'categoryId',
                    'categorizationStatus',
                    'categorizationSource',
                  ],
                },
              }),
            );
          }
        }
        return {
          size: candidates.length,
          lastId: candidates.at(-1)?.id ?? null,
          changed,
        };
      });

      examined += chunk.size;
      categorized += chunk.changed;
      if (chunk.size < CHUNK_SIZE || chunk.lastId === null) break;
      if (examined >= MAX_EXAMINED) {
        truncated = true;
        break;
      }
      afterId = chunk.lastId;
    }

    return {
      ruleId,
      from: input.from,
      to: input.to,
      examined,
      categorized,
      truncated,
    };
  }

  private loadApplicableRule(
    context: TenantContext,
    ruleId: string,
  ): Promise<CategoryRule> {
    return this.transactions.withTenant(context, async (scope) => {
      const snapshot = await scope.categoryRules.findById(ruleId);
      if (!snapshot || snapshot.tenantId !== context.tenantId) {
        throw new CategoryRuleNotFound(
          'The category rule was not found for the authenticated tenant.',
        );
      }
      const rule = CategoryRule.reconstitute(snapshot);
      if (rule.props.status === 'removed') {
        throw new CategoryRuleRemoved('Removed rules cannot be applied.');
      }
      if (rule.props.status !== 'active') {
        throw new InvalidTransactionRequest('Only active rules can be applied.');
      }
      const category = await scope.categories.findById(rule.props.categoryId);
      if (!category || category.tenantId !== context.tenantId) {
        throw new CategoryNotFound(
          'The category was not found for the authenticated tenant.',
        );
      }
      if (category.status === 'archived') {
        throw new CategoryArchived(
          'Archived categories cannot be assigned to transactions.',
        );
      }
      return rule;
    });
  }
}

function assertPeriod({ from, to }: ApplyCategoryRuleInput): void {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    new Date(start).toISOString().slice(0, 10) !== from ||
    new Date(end).toISOString().slice(0, 10) !== to ||
    end < start ||
    (end - start) / DAY_MS > MAX_PERIOD_DAYS
  ) {
    throw new InvalidTransactionRequest('Invalid application period.');
  }
}
