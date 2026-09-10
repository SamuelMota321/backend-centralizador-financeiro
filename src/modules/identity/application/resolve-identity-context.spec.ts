import { describe, expect, it, vi } from 'vitest';
import { ExternalIdentity } from '../domain/external-identity.js';
import type { IdentityContextResolver } from './ports/identity-context-resolver.port.js';
import { ResolveIdentityContext } from './resolve-identity-context.js';

describe('ResolveIdentityContext', () => {
  it('delegates identity resolution without exposing token claims', async () => {
    const context = {
      tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
      userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
    };
    const resolveOrProvision = vi.fn(() => Promise.resolve(context));
    const resolver: IdentityContextResolver = { resolveOrProvision };
    const useCase = new ResolveIdentityContext(resolver);
    const identity = ExternalIdentity.auth0(
      'https://tenant.example.com/',
      'auth0|subject',
    );

    await expect(useCase.execute(identity)).resolves.toEqual(context);
    expect(resolveOrProvision).toHaveBeenCalledWith(identity);
  });
});
