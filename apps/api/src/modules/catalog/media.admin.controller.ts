import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { MediaDto } from '@kid-toy/shared-types';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReorderMediaDto } from './dto/reorder-media.dto';
import { MediaService } from './media.service';

const MEDIA_TYPES = ['IMAGE', 'VIDEO'] as const;

/**
 * Multipart body accompanying the `file` field. Declared here (not a
 * dedicated dto/ file) since it's small and specific to this one route.
 */
class UploadMediaDto {
  @ApiProperty({ enum: MEDIA_TYPES })
  @IsIn(MEDIA_TYPES)
  type!: (typeof MEDIA_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altTextVi?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altTextEn?: string;
}

/**
 * Product media admin surface (CATALOG-02). Copies the exact RBAC pattern
 * documented in AdminProbeController: class-level
 * UseGuards(JwtAuthGuard, RolesGuard) plus an explicit per-route
 * Roles('SUPER_ADMIN', 'CONTENT') decorator (T-01-33).
 */
@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class MediaAdminController {
  constructor(private readonly media: MediaService) {}

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.CREATED)
  @Post('products/:id/media')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an image or video to a product' })
  @ApiResponse({ status: 201, description: 'Media created, url is a 900s presigned URL' })
  @ApiResponse({ status: 400, description: 'Validation failed (size/mimetype/type mismatch)' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async upload(
    @Param('id') productId: string,
    @Body() dto: UploadMediaDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<MediaDto> {
    return this.media.upload(productId, dto, file);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.OK)
  @Patch('products/:id/media/order')
  @ApiOperation({ summary: 'Reorder every media item for a product' })
  @ApiResponse({ status: 200, description: 'Reordered media list' })
  @ApiResponse({ status: 400, description: 'Partial/duplicate/foreign id set' })
  async reorder(
    @Param('id') productId: string,
    @Body() dto: ReorderMediaDto,
  ): Promise<MediaDto[]> {
    return this.media.reorder(productId, dto.orderedIds);
  }

  @Roles('SUPER_ADMIN', 'CONTENT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('media/:mediaId')
  @ApiOperation({ summary: 'Delete a media item (row + MinIO object)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  async remove(@Param('mediaId') mediaId: string): Promise<void> {
    await this.media.remove(mediaId);
  }
}
