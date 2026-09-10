import { Module } from '@nestjs/common';
import { PrismaIdentityContextResolver } from './adapters/outbound/prisma-identity-context-resolver.js';
import {
  ACCESS_TOKEN_VERIFIER,
  Auth0AccessTokenVerifier,
} from './adapters/inbound/auth0-access-token-verifier.js';
import { Auth0JwtGuard } from './adapters/inbound/auth0-jwt.guard.js';
import { ResolveIdentityContext } from './application/resolve-identity-context.js';

@Module({
  providers: [
    PrismaIdentityContextResolver,
    Auth0AccessTokenVerifier,
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useExisting: Auth0AccessTokenVerifier,
    },
    {
      provide: ResolveIdentityContext,
      useFactory: (resolver: PrismaIdentityContextResolver) =>
        new ResolveIdentityContext(resolver),
      inject: [PrismaIdentityContextResolver],
    },
    Auth0JwtGuard,
  ],
  exports: [
    PrismaIdentityContextResolver,
    ACCESS_TOKEN_VERIFIER,
    ResolveIdentityContext,
    Auth0JwtGuard,
  ],
})
export class IdentityModule {}
