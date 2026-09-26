import { parseDateTime } from './civil-date.js';
import type { Transaction } from './transaction.js';
import {
  CategoryRuleRemoved,
  InvalidCategoryRule,
} from './transactions.errors.js';

export type CategoryRuleConditionField = 'description' | 'type' | 'accountId';
export type CategoryRuleOperator =
  'equals' | 'contains' | 'starts_with' | 'ends_with';
export type CategoryRuleStatus = 'active' | 'inactive' | 'removed';

export const CATEGORY_RULE_PRIORITY_MAX = 2_147_483_647;

export type CategoryRuleProps = Readonly<{
  tenantId: string;
  categoryId: string;
  conditionField: CategoryRuleConditionField;
  conditionOperator: CategoryRuleOperator;
  conditionValue: string;
  priority: number;
  status: CategoryRuleStatus;
  removedAt: string | null;
}>;

export type CategoryRuleSnapshot = Readonly<{
  id: string;
  tenantId: string;
  categoryId: string;
  conditionField: CategoryRuleConditionField;
  conditionOperator: CategoryRuleOperator;
  conditionValue: string;
  priority: number;
  status: CategoryRuleStatus;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateCategoryRuleInput = Readonly<{
  tenantId: string;
  categoryId: string;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  priority: number;
}>;

export type UpdateCategoryRuleInput = Readonly<
  Partial<
    Pick<
      CreateCategoryRuleInput,
      | 'categoryId'
      | 'conditionField'
      | 'conditionOperator'
      | 'conditionValue'
      | 'priority'
    >
  >
>;

const CONDITION_FIELDS = ['description', 'type', 'accountId'] as const;
const OPERATORS = ['equals', 'contains', 'starts_with', 'ends_with'] as const;

export class CategoryRule {
  private constructor(
    readonly props: CategoryRuleProps,
    readonly snapshot: CategoryRuleSnapshot | null = null,
  ) {}

  static create(input: CreateCategoryRuleInput): CategoryRule {
    const rule = new CategoryRule({
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      conditionField: parseConditionField(input.conditionField),
      conditionOperator: parseOperator(input.conditionOperator),
      conditionValue: normalizeConditionValue(
        input.conditionValue,
        input.conditionField,
      ),
      priority: validatePriority(input.priority),
      status: 'active',
      removedAt: null,
    });
    rule.assertConditionInvariant();
    return rule;
  }

  static reconstitute(input: CategoryRuleSnapshot): CategoryRule {
    const rule = new CategoryRule(
      {
        tenantId: input.tenantId,
        categoryId: input.categoryId,
        conditionField: parseConditionField(input.conditionField),
        conditionOperator: parseOperator(input.conditionOperator),
        conditionValue: normalizeConditionValue(
          input.conditionValue,
          input.conditionField,
        ),
        priority: validatePriority(input.priority),
        status: input.status,
        removedAt: input.removedAt,
      },
      {
        ...input,
        createdAt: parseDateTime(input.createdAt),
        updatedAt: parseDateTime(input.updatedAt),
      },
    );
    rule.assertConditionInvariant();
    rule.assertLifecycleInvariant();
    return rule;
  }

  deactivate(updatedAt: string): CategoryRule {
    if (this.props.status === 'removed') {
      throw new CategoryRuleRemoved('Removed rules cannot be changed.');
    }
    return this.withState('inactive', null, updatedAt);
  }

  activate(updatedAt: string): CategoryRule {
    if (this.props.status === 'removed') {
      throw new CategoryRuleRemoved('Removed rules cannot be reactivated.');
    }
    return this.withState('active', null, updatedAt);
  }

  remove(updatedAt: string): CategoryRule {
    if (this.props.status === 'removed') {
      return this;
    }
    const timestamp = parseDateTime(updatedAt);
    return this.withState('removed', timestamp, timestamp);
  }

  update(input: UpdateCategoryRuleInput, updatedAt: string): CategoryRule {
    if (this.props.status === 'removed') {
      throw new CategoryRuleRemoved('Removed rules cannot be changed.');
    }

    const nextField = input.conditionField ?? this.props.conditionField;
    const nextOperator =
      input.conditionOperator ?? this.props.conditionOperator;
    const nextValue = input.conditionValue ?? this.props.conditionValue;
    const nextPriority = input.priority ?? this.props.priority;
    const timestamp = parseDateTime(updatedAt);
    const updated = new CategoryRule(
      {
        tenantId: this.props.tenantId,
        categoryId: input.categoryId ?? this.props.categoryId,
        conditionField: parseConditionField(nextField),
        conditionOperator: parseOperator(nextOperator),
        conditionValue: normalizeConditionValue(nextValue, nextField),
        priority: validatePriority(nextPriority),
        status: this.props.status,
        removedAt: this.props.removedAt,
      },
      this.snapshot ? { ...this.snapshot, updatedAt: timestamp } : null,
    );
    updated.assertConditionInvariant();
    return updated;
  }

  matches(transaction: Transaction): boolean {
    if (this.props.status !== 'active') return false;

    const candidate =
      this.props.conditionField === 'description'
        ? transaction.props.description
        : this.props.conditionField === 'type'
          ? transaction.props.type
          : transaction.props.accountId;
    if (candidate === null) return false;

    const left = normalizeForComparison(candidate, this.props.conditionField);
    const right = normalizeForComparison(
      this.props.conditionValue,
      this.props.conditionField,
    );
    switch (this.props.conditionOperator) {
      case 'equals':
        return left === right;
      case 'contains':
        return left.includes(right);
      case 'starts_with':
        return left.startsWith(right);
      case 'ends_with':
        return left.endsWith(right);
    }
  }

  private withState(
    status: CategoryRuleStatus,
    removedAt: string | null,
    updatedAt: string,
  ): CategoryRule {
    const timestamp = parseDateTime(updatedAt);
    return new CategoryRule(
      { ...this.props, status, removedAt },
      this.snapshot
        ? { ...this.snapshot, status, removedAt, updatedAt: timestamp }
        : null,
    );
  }

  private assertConditionInvariant(): void {
    if (
      this.props.conditionField !== 'description' &&
      this.props.conditionOperator !== 'equals'
    ) {
      throw new InvalidCategoryRule(
        'Type and accountId conditions support only equals.',
      );
    }
  }

  private assertLifecycleInvariant(): void {
    if (
      (this.props.status === 'removed' && this.props.removedAt === null) ||
      (this.props.status !== 'removed' && this.props.removedAt !== null)
    ) {
      throw new InvalidCategoryRule(
        'Rule status and removed timestamp must agree.',
      );
    }
  }
}

function parseConditionField(value: string): CategoryRuleConditionField {
  if ((CONDITION_FIELDS as readonly string[]).includes(value)) {
    return value as CategoryRuleConditionField;
  }
  throw new InvalidCategoryRule(`Unsupported rule condition field: ${value}.`);
}

function parseOperator(value: string): CategoryRuleOperator {
  if ((OPERATORS as readonly string[]).includes(value)) {
    return value as CategoryRuleOperator;
  }
  throw new InvalidCategoryRule(`Unsupported rule operator: ${value}.`);
}

function normalizeConditionValue(value: string, field: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) {
    throw new InvalidCategoryRule('Rule condition value cannot be empty.');
  }
  if (
    field === 'type' &&
    !['income', 'expense'].includes(normalized.toLowerCase())
  ) {
    throw new InvalidCategoryRule(
      'Type conditions must use income or expense.',
    );
  }
  if (
    field === 'accountId' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new InvalidCategoryRule(
      'Account conditions must use a canonical UUID.',
    );
  }
  return field === 'accountId' || field === 'type'
    ? normalized.toLowerCase()
    : normalized;
}

function normalizeForComparison(value: string, field: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return field === 'accountId' || field === 'type'
    ? normalized.toLowerCase()
    : normalized.toLowerCase();
}

function validatePriority(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > CATEGORY_RULE_PRIORITY_MAX
  ) {
    throw new InvalidCategoryRule(
      `Rule priority must be an integer between 0 and ${CATEGORY_RULE_PRIORITY_MAX}.`,
    );
  }
  return value;
}
