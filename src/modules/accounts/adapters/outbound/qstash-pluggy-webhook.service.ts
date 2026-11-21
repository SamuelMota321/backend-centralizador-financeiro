import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Receiver } from '@upstash/qstash';
import type { Environment } from '../../../../config/environment.schema.js';
import type { PluggyWebhookEvent } from '../../application/ports/pluggy-provider.port.js';
import type { TenantContext } from '../../../../shared/application/tenant-context.js';
import type { SyncJob } from '../../../sync/application/pluggy-sync.types.js';

export type PluggyInitialImportJob = Readonly<{
  runId: string;
  tenantId: string;
  userId: string;
}>;

export class QStashUnavailable extends Error {
  override readonly name = 'QStashUnavailable';
}

@Injectable()
export class QStashPluggyWebhookService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async publish(event: PluggyWebhookEvent): Promise<void> {
    const token = this.config.get('QSTASH_TOKEN', { infer: true });
    const baseUrl = this.config.get('QSTASH_URL', { infer: true });
    if (!token || !baseUrl) throw new QStashUnavailable();
    const client = new Client({
      baseUrl,
      token,
    });
    try {
      await client.publishJSON({
        url: this.workerUrl('pluggy-events'),
        body: event,
        redact: { body: true, header: true },
      });
    } catch {
      throw new QStashUnavailable();
    }
  }

  async publishInitialImport(
    runId: string,
    context: TenantContext,
  ): Promise<void> {
    const token = this.config.get('QSTASH_TOKEN', { infer: true });
    const baseUrl = this.config.get('QSTASH_URL', { infer: true });
    if (!token || !baseUrl) throw new QStashUnavailable();
    const client = new Client({ baseUrl, token });
    const body: PluggyInitialImportJob = {
      runId,
      tenantId: context.tenantId,
      userId: context.userId,
    };
    try {
      await client.publishJSON({
        url: this.workerUrl('pluggy-initial-imports'),
        body,
        redact: { body: true, header: true },
      });
    } catch {
      throw new QStashUnavailable();
    }
  }

  async publishSync(job: SyncJob): Promise<void> {
    const token = this.config.get('QSTASH_TOKEN', { infer: true });
    const baseUrl = this.config.get('QSTASH_URL', { infer: true });
    if (!token || !baseUrl) throw new QStashUnavailable();
    try {
      await new Client({ baseUrl, token }).publishJSON({
        url: this.workerUrl('pluggy-sync-runs'),
        body: job,
        retries: 3,
        retryDelay: '660000',
        redact: { body: true, header: true },
      });
    } catch {
      throw new QStashUnavailable();
    }
  }

  async verify(signature: string, rawBody: string): Promise<boolean> {
    const currentSigningKey = this.config.get('QSTASH_CURRENT_SIGNING_KEY', {
      infer: true,
    });
    const nextSigningKey = this.config.get('QSTASH_NEXT_SIGNING_KEY', {
      infer: true,
    });
    if (!currentSigningKey || !nextSigningKey) throw new QStashUnavailable();
    const receiver = new Receiver({
      currentSigningKey,
      nextSigningKey,
    });
    try {
      return await receiver.verify({
        signature,
        body: rawBody,
        url: this.workerUrl('pluggy-events'),
      });
    } catch {
      return false;
    }
  }

  async verifyInitialImport(
    signature: string,
    rawBody: string,
  ): Promise<boolean> {
    const currentSigningKey = this.config.get('QSTASH_CURRENT_SIGNING_KEY', {
      infer: true,
    });
    const nextSigningKey = this.config.get('QSTASH_NEXT_SIGNING_KEY', {
      infer: true,
    });
    if (!currentSigningKey || !nextSigningKey) throw new QStashUnavailable();
    const receiver = new Receiver({ currentSigningKey, nextSigningKey });
    try {
      return await receiver.verify({
        signature,
        body: rawBody,
        url: this.workerUrl('pluggy-initial-imports'),
      });
    } catch {
      return false;
    }
  }

  async verifySync(signature: string, rawBody: string): Promise<boolean> {
    return this.verifyForPath(signature, rawBody, 'pluggy-sync-runs');
  }

  async verifyDailySync(signature: string, rawBody: string): Promise<boolean> {
    return this.verifyForPath(signature, rawBody, 'pluggy-daily-sync');
  }

  private async verifyForPath(
    signature: string,
    rawBody: string,
    path: 'pluggy-sync-runs' | 'pluggy-daily-sync',
  ): Promise<boolean> {
    const currentSigningKey = this.config.get('QSTASH_CURRENT_SIGNING_KEY', {
      infer: true,
    });
    const nextSigningKey = this.config.get('QSTASH_NEXT_SIGNING_KEY', {
      infer: true,
    });
    if (!currentSigningKey || !nextSigningKey) throw new QStashUnavailable();
    try {
      return await new Receiver({ currentSigningKey, nextSigningKey }).verify({
        signature,
        body: rawBody,
        url: this.workerUrl(path),
      });
    } catch {
      return false;
    }
  }

  private workerUrl(
    path:
      | 'pluggy-events'
      | 'pluggy-initial-imports'
      | 'pluggy-sync-runs'
      | 'pluggy-daily-sync',
  ): string {
    const baseUrl = this.config.get('PUBLIC_API_BASE_URL', { infer: true });
    if (!baseUrl) throw new QStashUnavailable();
    return new URL(`/api/v1/internal/jobs/${path}`, baseUrl).toString();
  }
}
