import { describe, expect, it } from 'vitest';
import {
  canStartConnectionCollection,
  toConnectionView,
  type ConnectionRecord,
} from './connection.js';

const connection: ConnectionRecord = {
  id: '11aa1111-1111-4111-8111-111111111111',
  tenantId: '22aa2222-2222-4222-8222-222222222222',
  ownerUserId: '33aa3333-3333-4333-8333-333333333333',
  providerItemId: '44aa4444-4444-4444-8444-444444444444',
  status: 'connected',
  consentId: '55aa5555-5555-4555-8555-555555555555',
  consentStatus: 'granted',
  consentProducts: ['ACCOUNTS', 'TRANSACTIONS'],
  openFinancePermissionsGranted: ['ACCOUNTS_ALL'],
  consentCreatedAt: new Date('2026-10-01T00:00:00.000Z'),
  consentExpiresAt: new Date('2026-11-01T00:00:00.000Z'),
  consentRevokedAt: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
};

describe('connection consent eligibility', () => {
  it('allows collection only while a connected consent is granted and unexpired', () => {
    expect(
      canStartConnectionCollection(
        connection,
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      canStartConnectionCollection(
        { ...connection, status: 'partially_available' },
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it.each([
    {
      status: 'pending_authorization' as const,
      consentStatus: 'granted' as const,
    },
    { status: 'expired' as const, consentStatus: 'expired' as const },
    { status: 'revoked' as const, consentStatus: 'revoked' as const },
    { status: 'disconnected' as const, consentStatus: 'granted' as const },
    { status: 'connected' as const, consentStatus: 'revoked' as const },
  ])('blocks collection for $status/$consentStatus', (state) => {
    expect(
      canStartConnectionCollection(
        { ...connection, ...state },
        new Date('2026-10-15T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('blocks collection at the consent expiry instant', () => {
    expect(
      canStartConnectionCollection(
        connection,
        new Date('2026-11-01T00:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('does not expose the provider Item identifier in the API view', () => {
    const view = toConnectionView(connection);
    expect(view).not.toHaveProperty('providerItemId');
    expect(view.consent.products).toEqual(['ACCOUNTS', 'TRANSACTIONS']);
  });
});
