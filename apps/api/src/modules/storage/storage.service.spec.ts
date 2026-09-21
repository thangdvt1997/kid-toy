import { S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { StorageService } from './storage.service';

/**
 * MinIO is not reachable in this environment (no Docker locally — see
 * SUMMARY.md). `getSignedUrl` performs a pure local SigV4 signing
 * computation with no network round-trip, so that behavior is exercised for
 * real. `putObject` and the bucket-provisioning logic in `onModuleInit` do
 * require a live S3-API endpoint, so `S3Client.prototype.send` is mocked for
 * those cases — this still exercises the service's real command
 * construction/branching logic, not the network I/O itself.
 */
function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    MINIO_ENDPOINT: 'http://localhost:9000',
    MINIO_REGION: 'us-east-1',
    MINIO_ROOT_USER: 'minioadmin',
    MINIO_ROOT_PASSWORD: 'minioadmin-secret',
    MINIO_BUCKET_MEDIA: 'kidtoy-media',
    MINIO_BUCKET_DOCUMENTS: 'kidtoy-documents',
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('StorageService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildKey', () => {
    it('returns an unguessable, non-user-controlled key', () => {
      const service = new StorageService(fakeConfig());
      const key = service.buildKey('products', 'my original file name.PNG');
      expect(key.startsWith('products/')).toBe(true);
      expect(key.endsWith('.PNG')).toBe(true);
      expect(key).not.toContain('my original file name');
      // uuid v4 shape between the prefix and the extension
      expect(key).toMatch(
        /^products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.PNG$/,
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('returns a signed URL (no plain public path) with the requested expiry', async () => {
      const service = new StorageService(fakeConfig());
      const url = await service.getPresignedUrl('kidtoy-media', 'products/abc.png', 120);

      expect(url).toContain('X-Amz-Signature');
      expect(url).toContain('X-Amz-Expires=120');
      // must not be a plain, unsigned public path
      expect(url).not.toBe('http://localhost:9000/kidtoy-media/products/abc.png');
    });

    it('defaults to a 300 second expiry', async () => {
      const service = new StorageService(fakeConfig());
      const url = await service.getPresignedUrl('kidtoy-documents', 'docs/license.pdf');

      expect(url).toContain('X-Amz-Expires=300');
    });
  });

  describe('putObject', () => {
    it('uploads the object and returns its key', async () => {
      jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);

      const service = new StorageService(fakeConfig());
      const key = service.buildKey('products', 'photo.jpg');
      const returned = await service.putObject(
        service.bucketMedia,
        key,
        Buffer.from('fake-image-bytes'),
        'image/jpeg',
      );

      expect(returned).toBe(key);
    });
  });

  describe('onModuleInit', () => {
    it('creates a bucket privately when HeadBucket reports it missing (404)', async () => {
      const sends: string[] = [];
      jest.spyOn(S3Client.prototype, 'send').mockImplementation(((command: {
        constructor: { name: string };
      }) => {
        const name = command.constructor.name;
        sends.push(name);
        if (name === 'HeadBucketCommand') {
          const err = Object.assign(new Error('NotFound'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          });
          return Promise.reject(err);
        }
        return Promise.resolve({});
      }) as never);

      const service = new StorageService(fakeConfig());
      await service.onModuleInit();

      expect(sends).toContain('HeadBucketCommand');
      expect(sends).toContain('CreateBucketCommand');
      expect(sends).not.toContain('PutBucketPolicyCommand');
    });

    it('does not create a bucket that already exists', async () => {
      const sends: string[] = [];
      jest.spyOn(S3Client.prototype, 'send').mockImplementation(((command: {
        constructor: { name: string };
      }) => {
        sends.push(command.constructor.name);
        return Promise.resolve({});
      }) as never);

      const service = new StorageService(fakeConfig());
      await service.onModuleInit();

      expect(sends.filter((n) => n === 'HeadBucketCommand')).toHaveLength(2);
      expect(sends).not.toContain('CreateBucketCommand');
    });
  });

  describe('bucket name getters', () => {
    it('exposes bucketMedia and bucketDocuments from config', () => {
      const service = new StorageService(fakeConfig());
      expect(service.bucketMedia).toBe('kidtoy-media');
      expect(service.bucketDocuments).toBe('kidtoy-documents');
    });
  });
});
