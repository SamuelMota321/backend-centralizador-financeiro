export const CONNECTION_STATUSES = [
  'pending_authorization',
  'connected',
  'partially_available',
  'expired',
  'revoked',
  'disconnected',
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const CONSENT_STATUSES = ['granted', 'expired', 'revoked'] as const;

export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export type ConnectionRecord = Readonly<{
  id: string;
  tenantId: string;
  ownerUserId: string;
  providerItemId: string | null;
  status: ConnectionStatus;
  consentId: string | null;
  consentStatus: ConsentStatus | null;
  consentProducts: readonly string[];
  openFinancePermissionsGranted: readonly string[];
  consentCreatedAt: Date | null;
  consentExpiresAt: Date | null;
  consentRevokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ConnectionView = Readonly<{
  id: string;
  provider: 'pluggy';
  status: ConnectionStatus;
  consent: Readonly<{
    id: string | null;
    status: ConsentStatus | null;
    products: readonly string[];
    openFinancePermissionsGranted: readonly string[];
    grantedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}>;

export function toConnectionView(record: ConnectionRecord): ConnectionView {
  return {
    id: record.id,
    provider: 'pluggy',
    status: record.status,
    consent: {
      id: record.consentId,
      status: record.consentStatus,
      products: record.consentProducts,
      openFinancePermissionsGranted: record.openFinancePermissionsGranted,
      grantedAt: record.consentCreatedAt?.toISOString() ?? null,
      expiresAt: record.consentExpiresAt?.toISOString() ?? null,
      revokedAt: record.consentRevokedAt?.toISOString() ?? null,
    },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function canStartConnectionCollection(
  connection: Pick<
    ConnectionRecord,
    'status' | 'consentStatus' | 'consentExpiresAt'
  >,
  now: Date,
): boolean {
  return (
    (connection.status === 'connected' ||
      connection.status === 'partially_available') &&
    connection.consentStatus === 'granted' &&
    (connection.consentExpiresAt === null ||
      connection.consentExpiresAt.getTime() > now.getTime())
  );
}
