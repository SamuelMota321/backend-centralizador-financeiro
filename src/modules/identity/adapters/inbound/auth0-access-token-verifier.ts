import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auth, type AuthResult } from 'express-oauth2-jwt-bearer';
import type { Request, Response } from 'express';
import type { Environment } from '../../../../config/environment.schema.js';
import { ExternalIdentity } from '../../domain/external-identity.js';

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export interface AccessTokenVerifier {
  verify(request: Request, response: Response): Promise<ExternalIdentity>;
}

export class AccessTokenVerificationError extends Error {
  override readonly name = 'AccessTokenVerificationError';
}

@Injectable()
export class Auth0AccessTokenVerifier implements AccessTokenVerifier {
  private readonly middleware;

  constructor(config: ConfigService<Environment, true>) {
    this.middleware = auth({
      issuerBaseURL: config.get('AUTH0_ISSUER_BASE_URL', { infer: true }),
      audience: config.get('AUTH0_AUDIENCE', { infer: true }),
      authRequired: true,
      dpop: { enabled: false },
    });
  }

  verify(request: Request, response: Response): Promise<ExternalIdentity> {
    return new Promise((resolve, reject) => {
      this.middleware(request, response, (error?: unknown) => {
        if (error) {
          reject(new AccessTokenVerificationError());
          return;
        }

        try {
          resolve(this.toExternalIdentity(request.auth));
        } catch {
          reject(new AccessTokenVerificationError());
        }
      });
    });
  }

  private toExternalIdentity(result: AuthResult | undefined): ExternalIdentity {
    const issuer = result?.payload.iss;
    const subject = result?.payload.sub;
    if (typeof issuer !== 'string' || typeof subject !== 'string') {
      throw new AccessTokenVerificationError();
    }
    return ExternalIdentity.auth0(issuer, subject);
  }
}
