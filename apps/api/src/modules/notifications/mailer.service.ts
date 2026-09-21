import { Injectable, Logger } from '@nestjs/common';

/**
 * Phase 1 mail transport seam. There is no SMTP integration yet — every
 * "sent" message is written as a single structured log line containing the
 * recipient and the full delivery URL. This is a DELIBERATE Phase 1
 * decision (see 01-04-PLAN.md threat T-01-32: "Reset link written to
 * application logs" — accepted risk, dev/local scope only; the Phase 1 VPS
 * deploy is not a public production system with real users), not an
 * oversight. A later phase swaps only this method's body for a real SMTP
 * transport (or a BullMQ-queued send) without touching any caller —
 * callers depend only on this class's public method signatures.
 *
 * NEVER log a password hash or a token hash here — only the fully-formed
 * delivery URL, exactly as the recipient would see it.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async sendPasswordReset(to: string, resetUrl: string, locale: 'vi' | 'en'): Promise<void> {
    this.logger.log(`[mail:password-reset] to=${to} locale=${locale} url=${resetUrl}`);
  }
}
