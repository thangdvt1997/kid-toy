import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MediaDto } from '@kid-toy/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { buildFileValidationPipe } from '../../common/pipes/uploaded-document.validator';
import { StorageService } from '../storage/storage.service';
import { toMediaDto } from './catalog.mapper';

const MEDIA_URL_TTL_SECONDS = 900;
const MAX_IMAGE_BYTES = Number(process.env.UPLOAD_MAX_IMAGE_BYTES) || 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = Number(process.env.UPLOAD_MAX_VIDEO_BYTES) || 50 * 1024 * 1024;
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'];

export interface UploadMediaInput {
  type: 'IMAGE' | 'VIDEO';
  altTextVi?: string;
  altTextEn?: string;
}

/**
 * Product image/video upload, ordering and deletion (CATALOG-02). Files
 * live in MinIO; Postgres stores only the object key + metadata. Every
 * response carries a presigned URL — the raw objectKey is NEVER
 * serialized (T-01-35).
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    productId: string,
    input: UploadMediaInput,
    file: Express.Multer.File,
  ): Promise<MediaDto> {
    if (!file) {
      throw new BadRequestException('FILE_REQUIRED');
    }

    // Verify the product exists BEFORE touching storage, so a bad id never
    // leaves an orphaned object in MinIO (T-01-38).
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }

    const profile =
      input.type === 'IMAGE'
        ? { mimeTypes: IMAGE_MIME_TYPES, maxBytes: MAX_IMAGE_BYTES }
        : { mimeTypes: VIDEO_MIME_TYPES, maxBytes: MAX_VIDEO_BYTES };

    // Validates the DETECTED mimetype (magic-number sniffing) against the
    // profile selected from the declared `type` — a mismatch between what
    // the client claims and what the bytes actually are (or an oversized
    // file) throws 400 here (T-01-34).
    await buildFileValidationPipe(profile).transform(file);

    const objectKey = this.storage.buildKey('product-media', file.originalname);
    await this.storage.putObject(this.storage.bucketMedia, objectKey, file.buffer, file.mimetype);

    try {
      const current = await this.prisma.productMedia.aggregate({
        where: { productId },
        _max: { sortOrder: true },
      });
      const sortOrder = (current._max.sortOrder ?? -1) + 1;

      const row = await this.prisma.productMedia.create({
        data: {
          productId,
          type: input.type,
          objectKey,
          altTextVi: input.altTextVi ?? null,
          altTextEn: input.altTextEn ?? null,
          sortOrder,
        },
      });
      const url = await this.storage.getPresignedUrl(
        this.storage.bucketMedia,
        row.objectKey,
        MEDIA_URL_TTL_SECONDS,
      );
      return toMediaDto(row, url);
    } catch (err) {
      // Best-effort cleanup — the DB write failed, so the uploaded object
      // would otherwise be orphaned. Never let a cleanup failure mask the
      // original error.
      await this.storage.deleteObject(this.storage.bucketMedia, objectKey).catch(() => undefined);
      throw err;
    }
  }

  async reorder(productId: string, orderedIds: string[]): Promise<MediaDto[]> {
    const existing = await this.prisma.productMedia.findMany({ where: { productId } });
    const existingIds = new Set(existing.map((m) => m.id));
    const isPermutation =
      orderedIds.length === existing.length &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => existingIds.has(id));
    if (!isPermutation) {
      throw new BadRequestException('MEDIA_ORDER_MISMATCH');
    }

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.productMedia.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    const rows = await this.prisma.productMedia.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });
    const urls = await this.getPresignedUrls(rows);
    return rows.map((row) => toMediaDto(row, urls.get(row.id) ?? ''));
  }

  async remove(mediaId: string): Promise<void> {
    const row = await this.prisma.productMedia.findUnique({ where: { id: mediaId } });
    if (!row) {
      throw new NotFoundException('MEDIA_NOT_FOUND');
    }
    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    // A storage deletion failure is logged and swallowed so an orphaned
    // object never blocks the API response (T-01-38).
    await this.storage.deleteObject(this.storage.bucketMedia, row.objectKey).catch((err: unknown) => {
      this.logger.warn(
        `Failed to delete MinIO object "${row.objectKey}" for media ${mediaId}: ${String(err)}`,
      );
    });
  }

  /**
   * Batch presigned-URL resolution — getSignedUrl is a local HMAC
   * computation (no network round trip), so resolving N media rows'
   * URLs is done in parallel here rather than one-at-a-time per row.
   */
  async getPresignedUrls(rows: { id: string; objectKey: string }[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      rows.map(async (row) => {
        map.set(
          row.id,
          await this.storage.getPresignedUrl(this.storage.bucketMedia, row.objectKey, MEDIA_URL_TTL_SECONDS),
        );
      }),
    );
    return map;
  }
}
