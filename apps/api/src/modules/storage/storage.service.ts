import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { Env } from '../../config/env.schema';

const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 300;

interface S3LikeError {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

/**
 * Thin wrapper over the S3 SDK targeting MinIO. Public surface is exactly
 * what this plan's <interfaces> block declares — used for product media
 * (CATALOG-02) and B2B business-license uploads (AUTH-03).
 *
 * Buckets are created PRIVATE (no PutBucketPolicy, no public-read). Reads
 * only ever happen through short-lived presigned URLs — see T-01-08 in the
 * threat model.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly _bucketMedia: string;
  private readonly _bucketDocuments: string;

  constructor(config: ConfigService<Env, true>) {
    this.client = new S3Client({
      endpoint: config.get('MINIO_ENDPOINT', { infer: true }),
      region: config.get('MINIO_REGION', { infer: true }),
      forcePathStyle: true, // required for MinIO
      credentials: {
        accessKeyId: config.get('MINIO_ROOT_USER', { infer: true }),
        secretAccessKey: config.get('MINIO_ROOT_PASSWORD', { infer: true }),
      },
    });
    this._bucketMedia = config.get('MINIO_BUCKET_MEDIA', { infer: true });
    this._bucketDocuments = config.get('MINIO_BUCKET_DOCUMENTS', { infer: true });
  }

  get bucketMedia(): string {
    return this._bucketMedia;
  }

  get bucketDocuments(): string {
    return this._bucketDocuments;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket(this._bucketMedia);
    await this.ensureBucket(this._bucketDocuments);
  }

  private async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (err) {
      const e = err as S3LikeError;
      const notFound = e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
      if (!notFound) {
        throw err;
      }
      // Buckets are created PRIVATE — never set a public-read bucket policy.
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`Created MinIO bucket "${bucket}"`);
    }
  }

  /** Object keys are never derived from user input — random UUID + original extension only. */
  buildKey(prefix: string, originalName: string): string {
    return `${prefix}/${randomUUID()}${extname(originalName)}`;
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<string> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
    });
    await upload.done();
    return key;
  }

  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number = DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
