import { FileTypeValidator, MaxFileSizeValidator, ParseFilePipe } from '@nestjs/common';

export interface FileValidationOptions {
  maxBytes: number;
  mimeTypes: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reusable multipart file-validation pipe. Enforces a byte-size cap and an
 * allow-list of DETECTED mime types — NestJS's built-in FileTypeValidator
 * sniffs the actual magic number of the uploaded buffer via the `file-type`
 * package by default (not just the client-supplied Content-Type header and
 * not the filename extension). This defends against a spoofed mimetype or a
 * malicious file renamed with an allow-listed extension. See threat T-01-25
 * in 01-04-PLAN.md's threat model.
 *
 * NOTE: `file-type` must be an explicit direct dependency of apps/api (added
 * in this plan) — pnpm's strict node_modules layout does not expose it as a
 * resolvable transitive dependency of @nestjs/common, and without it
 * FileTypeValidator silently fails every upload (see 01-03-SUMMARY.md for
 * the identical class of pnpm-hoisting issue with the `ms` package).
 */
export function buildFileValidationPipe(options: FileValidationOptions): ParseFilePipe {
  const pattern = new RegExp(`^(${options.mimeTypes.map(escapeRegExp).join('|')})$`);
  return new ParseFilePipe({
    fileIsRequired: true,
    validators: [
      new MaxFileSizeValidator({ maxSize: options.maxBytes }),
      new FileTypeValidator({ fileType: pattern }),
    ],
  });
}
