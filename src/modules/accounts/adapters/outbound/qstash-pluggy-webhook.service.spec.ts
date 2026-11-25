import type { ConfigService } from '@nestjs/config';
import { Client } from '@upstash/qstash';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Environment } from '../../../../config/environment.schema.js';
import {
  QStashPluggyWebhookService,
  QStashUnavailable,
} from './qstash-pluggy-webhook.service.js';

afterEach(() => vi.restoreAllMocks());

describe('QStashPluggyWebhookService diagnostics', () => {
  it('classifies missing sync publisher configuration without retaining job data', async () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new QStashPluggyWebhookService(config);
    const job = {
      runId: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
    };

    const error = await service
      .publishSync(job)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(QStashUnavailable);
    expect(error).toMatchObject({
      operation: 'publish_sync',
      reason: 'missing_config',
    });
    expect(JSON.stringify(error)).not.toContain(job.runId);
  });

  it('reports a missing worker URL as configuration failure', async () => {
    const config = {
      get: (key: string) =>
        key === 'QSTASH_TOKEN' || key === 'QSTASH_URL'
          ? 'fixture-value'
          : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new QStashPluggyWebhookService(config);

    await expect(
      service.publishSync({ runId: 'run', tenantId: 'tenant', userId: 'user' }),
    ).rejects.toMatchObject({ reason: 'missing_config' });
  });

  it('classifies publisher failures without retaining the provider error', async () => {
    vi.spyOn(Client.prototype, 'publishJSON').mockRejectedValue(
      new Error('secret queue response'),
    );
    const config = {
      get: (key: string) =>
        key === 'QSTASH_TOKEN'
          ? 'fixture-token'
          : key === 'QSTASH_URL'
            ? 'https://qstash.example.com'
            : key === 'PUBLIC_API_BASE_URL'
              ? 'https://api.example.com'
              : undefined,
    } as unknown as ConfigService<Environment, true>;
    const service = new QStashPluggyWebhookService(config);

    const error = await service
      .publishSync({ runId: 'run', tenantId: 'tenant', userId: 'user' })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      operation: 'publish_sync',
      reason: 'publish_failed',
    });
    expect(JSON.stringify(error)).not.toContain('secret queue response');
  });
});
