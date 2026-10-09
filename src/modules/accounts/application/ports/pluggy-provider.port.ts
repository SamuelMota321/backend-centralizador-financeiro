export const PLUGGY_PROVIDER = Symbol('PLUGGY_PROVIDER');

export type PluggyConnectToken = Readonly<{
  accessToken: string;
  expiresAt: Date;
}>;

export type PluggyItemSnapshot = Readonly<{
  id: string;
  clientUserId: string | null;
  status: string;
  executionStatus: string;
}>;

export type PluggyConsentSnapshot = Readonly<{
  id: string;
  itemId: string;
  products: readonly string[];
  openFinancePermissionsGranted: readonly string[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}>;

export type PluggyWebhookEvent = Readonly<{
  event: string;
  eventId: string;
  itemId: string;
  clientUserId: string;
}>;

export interface PluggyProvider {
  createConnectToken(clientUserId: string): Promise<PluggyConnectToken>;
  getItem(itemId: string): Promise<PluggyItemSnapshot | null>;
  listConsents(itemId: string): Promise<readonly PluggyConsentSnapshot[]>;
  deleteItem(itemId: string): Promise<void>;
}
