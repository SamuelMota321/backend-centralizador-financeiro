import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';

describe('health API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());

  it('serves liveness under /api/v1', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server)
      .get('/api/v1/health/live')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('reports readiness only for the safe runtime role', async () => {
    const server = app.getHttpServer() as Server;
    const response = await request(server)
      .get('/api/v1/health/ready')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
