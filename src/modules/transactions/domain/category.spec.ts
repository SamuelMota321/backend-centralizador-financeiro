import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Category } from './category.js';
import {
  InvalidCategoryName,
  InvalidCategoryState,
} from './transactions.errors.js';

const tenantId = randomUUID();

describe('Category', () => {
  it('normalizes a user-owned active category', () => {
    const category = Category.create({ tenantId, name: '  Mercado\n mensal ' });

    expect(category.props).toMatchObject({
      name: 'Mercado mensal',
      source: 'user',
      status: 'active',
      archivedAt: null,
    });
  });

  it('archives a category without deleting its identity', () => {
    const category = Category.reconstitute({
      id: randomUUID(),
      tenantId,
      name: 'Mercado',
      source: 'user',
      status: 'active',
      archivedAt: null,
      createdAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
    });

    const archived = category.archive('2026-09-20T10:01:00.000Z');
    expect(archived.props.status).toBe('archived');
    expect(archived.props.archivedAt).toBe('2026-09-20T10:01:00.000Z');
    expect(archived.snapshot?.id).toBeDefined();
  });

  it('rejects blank, oversized and inconsistent categories', () => {
    expect(() => Category.create({ tenantId, name: '   ' })).toThrow(
      InvalidCategoryName,
    );
    expect(() => Category.create({ tenantId, name: 'a'.repeat(101) })).toThrow(
      InvalidCategoryName,
    );
    expect(() =>
      Category.reconstitute({
        id: randomUUID(),
        tenantId,
        name: 'Inconsistent',
        source: 'user',
        status: 'active',
        archivedAt: '2026-09-20T10:00:00.000Z',
        createdAt: '2026-09-20T10:00:00.000Z',
        updatedAt: '2026-09-20T10:00:00.000Z',
      }),
    ).toThrow(InvalidCategoryState);
  });
});
