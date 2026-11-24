import type { TenantContext } from '../../../shared/application/tenant-context.js';
import { AuditRecord } from '../../audit/application/audit-record.js';
import {
  isUuid,
  normalizePatrimony,
  type PatrimonyData,
  type PatrimonyKind,
} from '../domain/patrimony.js';
import type {
  PatrimonyPage,
  PatrimonyRepository,
  PatrimonyView,
  RevisionView,
} from './ports/patrimony.repository.port.js';

export class PatrimonyNotFound extends Error {
  override readonly name = 'PatrimonyNotFound';
}

const RESOURCE_TYPE = {
  asset: 'patrimonial_asset',
  financing: 'financing',
  liability: 'liability',
} as const;

export class PatrimonyService {
  constructor(private readonly repository: PatrimonyRepository) {}

  create(
    context: TenantContext,
    kind: PatrimonyKind,
    input: PatrimonyData,
    requestId: string,
  ): Promise<PatrimonyView> {
    const data = normalizePatrimony(kind, input);
    return this.repository.withTenant(context, async ({ records, audit }) => {
      if (
        kind === 'financing' &&
        (data as { assetId: string | null }).assetId &&
        !(await records.assetExists((data as { assetId: string }).assetId))
      ) {
        throw new PatrimonyNotFound('Asset was not found.');
      }
      const view = await records.create(kind, data);
      await records.addRevision(view, context.userId, requestId);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'patrimony_created',
          resourceType: RESOURCE_TYPE[kind],
          resourceId: view.id,
          outcome: 'success',
          requestId,
          metadata: { changedFields: [] },
        }),
      );
      return view;
    });
  }

  update(
    context: TenantContext,
    kind: PatrimonyKind,
    id: string,
    patch: Partial<PatrimonyData>,
    requestId: string,
  ): Promise<PatrimonyView> {
    this.assertId(id);
    return this.repository.withTenant(context, async ({ records, audit }) => {
      const current = await records.findForUpdate(kind, id);
      if (!current) throw new PatrimonyNotFound('Record was not found.');
      const previous = dataFromView(current);
      const data = normalizePatrimony(kind, {
        ...previous,
        ...patch,
      } as PatrimonyData);
      if (
        kind === 'financing' &&
        (data as { assetId: string | null }).assetId &&
        !(await records.assetExists((data as { assetId: string }).assetId))
      ) {
        throw new PatrimonyNotFound('Asset was not found.');
      }
      const changedFields = Object.keys(data).filter(
        (field) =>
          data[field as keyof PatrimonyData] !==
          previous[field as keyof PatrimonyData],
      ) as Array<
        | 'type'
        | 'description'
        | 'estimatedValue'
        | 'valuationDate'
        | 'source'
        | 'outstandingBalance'
        | 'assetId'
      >;
      if (changedFields.length === 0) return current;
      const view = await records.update(kind, id, data, current.version + 1);
      await records.addRevision(view, context.userId, requestId);
      await audit.write(
        AuditRecord.create({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          action: 'patrimony_updated',
          resourceType: RESOURCE_TYPE[kind],
          resourceId: id,
          outcome: 'success',
          requestId,
          metadata: { changedFields },
        }),
      );
      return view;
    });
  }

  get(
    context: TenantContext,
    kind: PatrimonyKind,
    id: string,
  ): Promise<PatrimonyView> {
    this.assertId(id);
    return this.repository.withTenant(context, async ({ records }) => {
      const view = await records.find(kind, id);
      if (!view) throw new PatrimonyNotFound('Record was not found.');
      return view;
    });
  }

  list(
    context: TenantContext,
    kind: PatrimonyKind,
    page: number,
    pageSize: number,
  ): Promise<PatrimonyPage> {
    return this.repository.withTenant(context, ({ records }) =>
      records.list(kind, page, pageSize),
    );
  }

  history(
    context: TenantContext,
    kind: PatrimonyKind,
    id: string,
  ): Promise<RevisionView[]> {
    this.assertId(id);
    return this.repository.withTenant(context, async ({ records }) => {
      if (!(await records.find(kind, id)))
        throw new PatrimonyNotFound('Record was not found.');
      return records.history(kind, id);
    });
  }

  private assertId(id: string): void {
    if (!isUuid(id)) throw new PatrimonyNotFound('Record was not found.');
  }
}

function dataFromView(view: PatrimonyView): PatrimonyData {
  if (view.kind === 'asset')
    return {
      type: view.type,
      description: view.description,
      estimatedValue: view.estimatedValue,
      valuationDate: view.valuationDate,
      source: view.source,
    };
  if (view.kind === 'financing')
    return {
      description: view.description,
      outstandingBalance: view.outstandingBalance,
      assetId: view.assetId,
    };
  return {
    description: view.description,
    outstandingBalance: view.outstandingBalance,
  };
}
