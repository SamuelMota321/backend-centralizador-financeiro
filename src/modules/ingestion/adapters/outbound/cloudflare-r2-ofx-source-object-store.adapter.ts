import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Environment } from '../../../../config/environment.schema.js';
import { IngestionObjectStoreUnavailable } from '../../domain/ingestion.errors.js';
import type { OfxSourceObjectStore } from '../../application/ports/ofx-source-object-store.port.js';

@Injectable()
export class CloudflareR2OfxSourceObjectStore
  implements OfxSourceObjectStore, OnModuleDestroy
{
  private readonly client: S3Client | null;
  private readonly bucketName: string | null;

  constructor(config: ConfigService<Environment, true>) {
    const endpoint = config.get('R2_ENDPOINT', { infer: true });
    const bucketName = config.get('R2_BUCKET_NAME', { infer: true });
    const accessKeyId = config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    this.bucketName = bucketName ?? null;
    this.client =
      endpoint && bucketName && accessKeyId && secretAccessKey
        ? new S3Client({
            endpoint,
            region: 'auto',
            forcePathStyle: true,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    const { client, bucketName } = this.requireConfiguration();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: content,
          ContentType: 'application/octet-stream',
        }),
      );
    } catch {
      throw new IngestionObjectStoreUnavailable();
    }
  }

  async delete(key: string): Promise<void> {
    const { client, bucketName } = this.requireConfiguration();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
    } catch {
      throw new IngestionObjectStoreUnavailable();
    }
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  private requireConfiguration(): Readonly<{
    client: S3Client;
    bucketName: string;
  }> {
    if (!this.client || !this.bucketName) {
      throw new IngestionObjectStoreUnavailable();
    }
    return { client: this.client, bucketName: this.bucketName };
  }
}
