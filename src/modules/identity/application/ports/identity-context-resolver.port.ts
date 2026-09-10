import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { ExternalIdentity } from '../../domain/external-identity.js';

export interface IdentityContextResolver {
  resolveOrProvision(identity: ExternalIdentity): Promise<TenantContext>;
}
