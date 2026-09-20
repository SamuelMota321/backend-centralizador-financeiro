import { parseDateTime } from './civil-date.js';
import {
  CategoryRuleRemoved,
  InvalidCategoryRule,
} from './transactions.errors.js';

export type CategoryRuleConditionField = 'description' | 'type' | 'accountId';
export type CategoryRuleOperator =
  'equals' | 'contains' | 'starts_with' | 'ends_with';
export type CategoryRuleStatus = 'active' | 'inactive' | 'removed';

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
      conditionValue: normalizeConditionValue(input.conditionValue),
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
        conditionValue: normalizeConditionValue(input.conditionValue),
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

function normalizeConditionValue(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidCategoryRule('Rule condition value cannot be empty.');
  }
  return normalized;
}

function validatePriority(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidCategoryRule(
      'Rule priority must be a non-negative integer.',
    );
  }
  return value;
}
