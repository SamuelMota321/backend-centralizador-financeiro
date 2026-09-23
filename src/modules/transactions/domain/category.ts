import { parseDateTime } from './civil-date.js';
import {
  InvalidCategoryName,
  InvalidCategoryState,
} from './transactions.errors.js';

export type CategorySource = 'user';
export type CategoryStatus = 'active' | 'archived';

export type CategoryProps = Readonly<{
  tenantId: string;
  name: string;
  source: CategorySource;
  status: CategoryStatus;
  archivedAt: string | null;
}>;

export type CategorySnapshot = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  source: CategorySource;
  status: CategoryStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateCategoryInput = Readonly<{
  tenantId: string;
  name: string;
}>;

export class Category {
  private constructor(
    readonly props: CategoryProps,
    readonly snapshot: CategorySnapshot | null = null,
  ) {}

  static create(input: CreateCategoryInput): Category {
    return new Category({
      tenantId: input.tenantId,
      name: normalizeCategoryName(input.name),
      source: 'user',
      status: 'active',
      archivedAt: null,
    });
  }

  static reconstitute(input: CategorySnapshot): Category {
    const category = new Category(
      {
        tenantId: input.tenantId,
        name: normalizeCategoryName(input.name),
        source: input.source,
        status: input.status,
        archivedAt: input.archivedAt,
      },
      {
        ...input,
        createdAt: parseDateTime(input.createdAt),
        updatedAt: parseDateTime(input.updatedAt),
      },
    );
    category.assertInvariants();
    return category;
  }

  archive(updatedAt: string): Category {
    if (this.props.status === 'archived') {
      return this;
    }
    return new Category(
      {
        ...this.props,
        status: 'archived',
        archivedAt: parseDateTime(updatedAt),
      },
      this.snapshot
        ? {
            ...this.snapshot,
            status: 'archived',
            archivedAt: parseDateTime(updatedAt),
            updatedAt: parseDateTime(updatedAt),
          }
      : null,
    );
  }

  rename(name: string, updatedAt: string): Category {
    if (this.props.status === 'archived') {
      throw new InvalidCategoryState('Archived categories cannot be edited.');
    }
    const normalizedName = normalizeCategoryName(name);
    const timestamp = parseDateTime(updatedAt);
    return new Category(
      { ...this.props, name: normalizedName },
      this.snapshot
        ? { ...this.snapshot, name: normalizedName, updatedAt: timestamp }
        : null,
    );
  }

  private assertInvariants(): void {
    if (
      (this.props.status === 'active' && this.props.archivedAt !== null) ||
      (this.props.status === 'archived' && this.props.archivedAt === null)
    ) {
      throw new InvalidCategoryState(
        'Category status and archived timestamp must agree.',
      );
    }
  }
}

function normalizeCategoryName(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0 || normalized.length > 100) {
    throw new InvalidCategoryName(
      'Category name must contain between 1 and 100 characters.',
    );
  }
  return normalized;
}
