import {
  CategoryRule,
  type CategoryRuleSnapshot,
} from '../../domain/category-rule.js';
import type { Transaction } from '../../domain/transaction.js';

/**
 * Regras ativas, na ordem de avaliacao do servidor (prioridade, depois a mais antiga), prontas
 * para categorizar varias linhas de uma vez sem reler o banco.
 */
export function toEvaluableRules(
  snapshots: readonly CategoryRuleSnapshot[],
): CategoryRule[] {
  return snapshots.map((snapshot) => CategoryRule.reconstitute(snapshot));
}

/**
 * Categoriza uma movimentacao importada pela primeira regra que casa, como ja acontece na
 * criacao manual. Sem regra que case, devolve a movimentacao como veio (sem classificacao).
 */
export function categorizeWithRules(
  rules: readonly CategoryRule[],
  transaction: Transaction,
  at: string = new Date().toISOString(),
): Transaction {
  const match = rules.find((rule) => rule.matches(transaction));
  return match
    ? transaction.categorize(match.props.categoryId, 'rule', at)
    : transaction;
}
