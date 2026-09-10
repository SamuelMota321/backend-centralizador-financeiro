import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { Handler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../../../config/environment.schema.js';
import {
  AccessTokenVerificationError,
  Auth0AccessTokenVerifier,
} from './auth0-access-token-verifier.js';

const authMock = vi.hoisted(() => vi.fn());

vi.mock('express-oauth2-jwt-bearer', () => ({ auth: authMock }));

const values: Environment = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://runtime:secret@localhost:5432/cfi',
  AUTH0_ISSUER_BASE_URL: 'https://tenant.example.com/',
  AUTH0_AUDIENCE: 'https://api.example.com',
};

const config = {
  get(key: keyof Environment): Environment[keyof Environment] {
    return values[key];
  },
} as unknown as ConfigService<Environment, true>;

describe('Auth0AccessTokenVerifier', () => {
  beforeEach(() => authMock.mockReset());

  it('configures bearer-only validation and returns an external identity', async () => {
    const middleware: Handler = (
      request: Request,
      _response: Response,
      next: NextFunction,
    ) => {
      request.auth = {
        header: {},
        payload: {
          iss: 'https://tenant.example.com/',
          sub: 'auth0|subject',
        },
        token: 'not-logged',
      };
      next();
    };
    authMock.mockReturnValue(middleware);
    const verifier = new Auth0AccessTokenVerifier(config);

    const identity = await verifier.verify({} as Request, {} as Response);

    expect(identity).toMatchObject({
      provider: 'auth0',
      issuer: 'https://tenant.example.com/',
      subject: 'auth0|subject',
    });
    expect(authMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerBaseURL: 'https://tenant.example.com/',
        audience: 'https://api.example.com',
        authRequired: true,
        dpop: { enabled: false },
      }),
    );
  });

  it('rejects middleware failures without exposing their message', async () => {
    const middleware: Handler = (_request, _response, next) =>
      next(new Error('sensitive verifier detail'));
    authMock.mockReturnValue(middleware);
    const verifier = new Auth0AccessTokenVerifier(config);

    await expect(
      verifier.verify({} as Request, {} as Response),
    ).rejects.toEqual(new AccessTokenVerificationError());
  });

  it('rejects tokens without issuer or subject', async () => {
    const middleware: Handler = (request, _response, next) => {
      request.auth = { header: {}, payload: {}, token: 'not-logged' };
      next();
    };
    authMock.mockReturnValue(middleware);
    const verifier = new Auth0AccessTokenVerifier(config);

    await expect(
      verifier.verify({} as Request, {} as Response),
    ).rejects.toBeInstanceOf(AccessTokenVerificationError);
  });
});
