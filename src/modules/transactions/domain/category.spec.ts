import { describe, expect, it } from 'vitest';
import { Category } from './category.js';
import {
  InvalidCategoryName,
  InvalidCategoryState,
} from './transactions.errors.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

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
      id: '22222222-2222-4222-8222-222222222222',
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
    expect(archived.snapshot?.id).toBe('22222222-2222-4222-8222-222222222222');
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
        id: '33333333-3333-4333-8333-333333333333',
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
