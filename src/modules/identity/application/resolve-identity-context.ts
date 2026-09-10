import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { ExternalIdentity } from '../domain/external-identity.js';
import type { IdentityContextResolver } from './ports/identity-context-resolver.port.js';

export class ResolveIdentityContext {
  constructor(private readonly resolver: IdentityContextResolver) {}

  execute(identity: ExternalIdentity): Promise<TenantContext> {
    return this.resolver.resolveOrProvision(identity);
  }
}
