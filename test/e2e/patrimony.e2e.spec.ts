import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  ACCESS_TOKEN_VERIFIER,
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from '../../src/modules/identity/adapters/inbound/auth0-access-token-verifier.js';
import { ExternalIdentity } from '../../src/modules/identity/domain/external-identity.js';
import { RequestIdMiddleware } from '../../src/shared/adapters/inbound/request-id.middleware.js';

describe('manual patrimony API', () => {
  let app: NestExpressApplication;
  let server: Server;
  const subjects = {
    first: `auth0|${randomUUID()}`,
    second: `auth0|${randomUUID()}`,
  };
  const verifier: AccessTokenVerifier = {
    verify: (incomingRequest) => {
      const token = incomingRequest.headers.authorization?.replace(
        /^Bearer\s+/i,
        '',
      );
      if (!token) return Promise.reject(new AccessTokenVerificationError());
      return Promise.resolve(
        ExternalIdentity.auth0(
          'https://patrimony.auth0.example/',
          token === 'second' ? subjects.second : subjects.first,
        ),
      );
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useBodyParser('json');
    app.use(new RequestIdMiddleware().use);
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('validates fields and protects routes with authentication', async () => {
    await request(server).get('/api/v1/patrimony/assets').expect(401);
    await request(server)
      .post('/api/v1/patrimony/assets')
      .set('Authorization', 'Bearer first')
      .send({
        type: 'Home',
        description: 'Synthetic',
        estimatedValue: '-1',
        valuationDate: '2026-11-01',
        source: 'Owner',
      })
      .expect(400);
    await request(server)
      .post('/api/v1/patrimony/financings')
      .set('Authorization', 'Bearer first')
      .send({
        description: 'Synthetic',
        outstandingBalance: '1',
        assetId: 'bad',
      })
      .expect(400);
    await request(server)
      .post('/api/v1/patrimony/liabilities')
      .set('Authorization', 'Bearer first')
      .send({
        description: 'Synthetic',
        outstandingBalance: '1',
        tenantId: randomUUID(),
      })
      .expect(400);
  });

  it('creates, updates and reads history, including unassociated financing', async () => {
    const asset = await request(server)
      .post('/api/v1/patrimony/assets')
      .set('Authorization', 'Bearer first')
      .send({
        type: 'Home',
        description: 'Synthetic home',
        estimatedValue: '100',
        valuationDate: '2026-11-01',
        source: 'Owner',
      })
      .expect(201);
    const assetId = (asset.body as { id: string }).id;
    const financing = await request(server)
      .post('/api/v1/patrimony/financings')
      .set('Authorization', 'Bearer first')
      .send({ description: 'Synthetic loan', outstandingBalance: '10' })
      .expect(201);
    expect(financing.body).toMatchObject({
      assetId: null,
      outstandingBalance: '10.00',
    });
    const financingId = (financing.body as { id: string }).id;
    await request(server)
      .patch(`/api/v1/patrimony/financings/${financingId}`)
      .set('Authorization', 'Bearer first')
      .send({ assetId })
      .expect(200);
    const renamed = await request(server)
      .patch(`/api/v1/patrimony/financings/${financingId}`)
      .set('Authorization', 'Bearer first')
      .send({ description: 'Renamed loan' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      assetId,
      description: 'Renamed loan',
    });
    const history = await request(server)
      .get(`/api/v1/patrimony/financings/${financingId}/history`)
      .set('Authorization', 'Bearer first')
      .expect(200);
    expect(history.body).toHaveLength(3);
    const revisions = history.body as Array<{
      version: number;
      state: { assetId: string | null };
    }>;
    expect(revisions[0]).toMatchObject({ version: 3, state: { assetId } });
    expect(revisions[1]).toMatchObject({ version: 2, state: { assetId } });
    expect(revisions[2]).toMatchObject({
      version: 1,
      state: { assetId: null },
    });
    await request(server)
      .get(`/api/v1/patrimony/assets/${assetId}`)
      .set('Authorization', 'Bearer second')
      .expect(404);
    await request(server)
      .patch(`/api/v1/patrimony/assets/${assetId}`)
      .set('Authorization', 'Bearer second')
      .send({ description: 'Foreign' })
      .expect(404);
    await request(server)
      .post('/api/v1/patrimony/financings')
      .set('Authorization', 'Bearer second')
      .send({ description: 'Foreign', outstandingBalance: '1', assetId })
      .expect(404);
  });
});
