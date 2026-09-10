import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvalidTenantContext } from '../../../../shared/application/tenant-context.js';
import { ResolveIdentityContext } from '../../application/resolve-identity-context.js';
import { IdentityContextUnavailable } from '../../domain/identity.errors.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from './auth0-access-token-verifier.js';
import type { TenantContextRequest } from './tenant-context.decorator.js';

@Injectable()
export class Auth0JwtGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly verifier: AccessTokenVerifier,
    private readonly resolveIdentityContext: ResolveIdentityContext,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const http = executionContext.switchToHttp();
    const request = http.getRequest<TenantContextRequest>();
    const response = http.getResponse<Response>();

    try {
      const identity = await this.verifier.verify(request, response);
      request.tenantContext =
        await this.resolveIdentityContext.execute(identity);
      return true;
    } catch (error) {
      if (error instanceof AccessTokenVerificationError) {
        throw new UnauthorizedException('Authentication required.');
      }
      if (
        error instanceof IdentityContextUnavailable ||
        error instanceof InvalidTenantContext
      ) {
        throw new ForbiddenException('Identity context unavailable.');
      }
      throw error;
    }
  }
}
