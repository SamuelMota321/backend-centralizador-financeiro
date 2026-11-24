import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { AuditWriter } from '../../../audit/application/ports/audit-writer.port.js';
import type {
  AssetData,
  DebtData,
  FinancingData,
  PatrimonyData,
  PatrimonyKind,
} from '../../domain/patrimony.js';

type ViewBase = Readonly<{
  id: string;
  kind: PatrimonyKind;
  currencyCode: 'BRL';
  version: number;
  createdAt: string;
  updatedAt: string;
}>;
export type AssetView = ViewBase & AssetData & Readonly<{ kind: 'asset' }>;
export type FinancingView = ViewBase &
  FinancingData &
  Readonly<{ kind: 'financing' }>;
export type LiabilityView = ViewBase &
  DebtData &
  Readonly<{ kind: 'liability' }>;
export type PatrimonyView = AssetView | FinancingView | LiabilityView;
export type RevisionView = Readonly<{
  version: number;
  actorUserId: string;
  requestId: string;
  createdAt: string;
  state: PatrimonyData;
}>;
export type PatrimonyPage = Readonly<{
  items: PatrimonyView[];
  page: number;
  pageSize: number;
  total: number;
}>;

export interface TenantPatrimonyRepository {
  create(kind: PatrimonyKind, data: PatrimonyData): Promise<PatrimonyView>;
  find(kind: PatrimonyKind, id: string): Promise<PatrimonyView | null>;
  findForUpdate(kind: PatrimonyKind, id: string): Promise<PatrimonyView | null>;
  list(
    kind: PatrimonyKind,
    page: number,
    pageSize: number,
  ): Promise<PatrimonyPage>;
  update(
    kind: PatrimonyKind,
    id: string,
    data: PatrimonyData,
    version: number,
  ): Promise<PatrimonyView>;
  addRevision(
    view: PatrimonyView,
    actorUserId: string,
    requestId: string,
  ): Promise<void>;
  history(kind: PatrimonyKind, id: string): Promise<RevisionView[]>;
  assetExists(id: string): Promise<boolean>;
}

export interface PatrimonyRepository {
  withTenant<Result>(
    context: TenantContext,
    operation: (
      scope: Readonly<{
        records: TenantPatrimonyRepository;
        audit: AuditWriter;
      }>,
    ) => Promise<Result>,
  ): Promise<Result>;
}
