import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { buildFileValidationPipe } from '../../common/pipes/uploaded-document.validator';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { BusinessAccountsService } from './business-accounts.service';
import { RegisterBusinessDto } from './dto/register-business.dto';

// Overridable via env the way AUTH_THROTTLE_LIMIT already is, so an e2e
// suite making many sequential registrations from one client isn't
// throttled; unset in production/dev, so the secure default of 5/min
// applies there (T-01-31: upload/registration flooding).
const REGISTER_THROTTLE_LIMIT = Number(process.env.BUSINESS_REGISTER_THROTTLE_LIMIT) || 5;
const REGISTER_THROTTLE = { default: { limit: REGISTER_THROTTLE_LIMIT, ttl: 60_000 } };

const MAX_DOCUMENT_BYTES = Number(process.env.UPLOAD_MAX_DOCUMENT_BYTES) || 10 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

@ApiTags('business-accounts')
@Controller('business-accounts')
export class BusinessAccountsController {
  constructor(private readonly businessAccounts: BusinessAccountsService) {}

  @Throttle(REGISTER_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  @Post('register')
  @UseInterceptors(FileInterceptor('licence'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Register a new B2B business account (starts PENDING)' })
  @ApiResponse({ status: 201, description: 'Business account created, PENDING approval' })
  @ApiResponse({ status: 400, description: 'Validation failed (including licence file)' })
  @ApiResponse({ status: 409, description: 'Email or tax ID already registered' })
  async register(
    @Body() dto: RegisterBusinessDto,
    @UploadedFile(
      buildFileValidationPipe({ maxBytes: MAX_DOCUMENT_BYTES, mimeTypes: DOCUMENT_MIME_TYPES }),
    )
    file: Express.Multer.File,
  ): Promise<{ accountId: string; approvalStatus: 'PENDING' }> {
    return this.businessAccounts.register(dto, file);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':id/licence')
  @ApiOperation({
    summary: 'Get a short-lived presigned URL for the uploaded business licence',
  })
  @ApiResponse({ status: 200, description: 'Presigned URL, expires in 300 seconds' })
  @ApiResponse({ status: 403, description: 'Not authorized to view this licence' })
  async getLicence(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.businessAccounts.getLicenceUrl(id, user);
  }
}
