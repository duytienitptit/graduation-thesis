import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CODE_LIFETIME_MS = 15 * 60 * 1000;

export type LinkResult = 'linked' | 'invalid-code' | 'chat-in-use';

@Injectable()
export class TelegramLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** A new code replaces any unused one, so only the latest link works. */
  async createCode(designerId: string) {
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(this.clock.now().getTime() + CODE_LIFETIME_MS);
    await this.prisma.$transaction([
      this.prisma.telegramLinkCode.deleteMany({ where: { designerId, usedAt: null } }),
      this.prisma.telegramLinkCode.create({ data: { code, designerId, expiresAt } }),
    ]);
    return { code, expiresAt };
  }

  async link(code: string, chatId: string, username?: string): Promise<LinkResult> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.telegramLinkCode.findUnique({ where: { code } });
      if (!found) return 'invalid-code';

      const owner = await tx.designerProfile.findUnique({ where: { telegramChatId: chatId } });
      if (owner && owner.id !== found.designerId) return 'chat-in-use';

      // Marking it used here is what makes the code work only once.
      const { count } = await tx.telegramLinkCode.updateMany({
        where: { code, usedAt: null, expiresAt: { gt: this.clock.now() } },
        data: { usedAt: this.clock.now() },
      });
      if (!count) return 'invalid-code';

      await tx.designerProfile.update({
        where: { id: found.designerId },
        data: { telegramChatId: chatId, telegramUsername: username ?? null },
      });
      return 'linked';
    });
  }
}
