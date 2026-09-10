import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import type { IdentityContextResolver } from '../../application/ports/identity-context-resolver.port.js';
import { ResolveIdentityContext } from '../../application/resolve-identity-context.js';
import { ExternalIdentity } from '../../domain/external-identity.js';
import { IdentityContextUnavailable } from '../../domain/identity.errors.js';
import {
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from './auth0-access-token-verifier.js';
import { Auth0JwtGuard } from './auth0-jwt.guard.js';
import type { TenantContextRequest } from './tenant-context.decorator.js';

const context = {
  tenantId: '21b0709d-78d6-4f3d-a28e-fb5575ddc3ee',
  userId: '660e6d8c-88b8-48e9-99f7-635d6e868e2a',
};

function executionContext(request: TenantContextRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}) as Response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('Auth0JwtGuard', () => {
  it('attaches only the resolved tenant context', async () => {
    const identity = ExternalIdentity.auth0(
      'https://tenant.example.com/',
      'auth0|subject',
    );
    const verifier: AccessTokenVerifier = {
      verify: () => Promise.resolve(identity),
    };
    const resolver: IdentityContextResolver = {
      resolveOrProvision: () => Promise.resolve(context),
    };
    const request = {} as TenantContextRequest;
    const guard = new Auth0JwtGuard(
      verifier,
      new ResolveIdentityContext(resolver),
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(request.tenantContext).toEqual(context);
    expect(request).not.toHaveProperty('auth');
  });

  it('maps access-token rejection to unauthorized', async () => {
    const verifier: AccessTokenVerifier = {
      verify: () => Promise.reject(new AccessTokenVerificationError()),
    };
    const resolver: IdentityContextResolver = {
      resolveOrProvision: () => Promise.resolve(context),
    };
    const guard = new Auth0JwtGuard(
      verifier,
      new ResolveIdentityContext(resolver),
    );

    await expect(
      guard.canActivate(executionContext({} as TenantContextRequest)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps an unavailable local identity context to forbidden', async () => {
    const identity = ExternalIdentity.auth0(
      'https://tenant.example.com/',
      'auth0|subject',
    );
    const verifier: AccessTokenVerifier = {
      verify: () => Promise.resolve(identity),
    };
    const resolver: IdentityContextResolver = {
      resolveOrProvision: () =>
        Promise.reject(new IdentityContextUnavailable()),
    };
    const guard = new Auth0JwtGuard(
      verifier,
      new ResolveIdentityContext(resolver),
    );

    await expect(
      guard.canActivate(executionContext({} as TenantContextRequest)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
