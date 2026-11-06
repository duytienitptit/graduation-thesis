import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DesignersService {
  constructor(private readonly prisma: PrismaService) {}

  async getByUser(userId: string) {
    const profile = await this.prisma.designerProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No designer profile');
    return profile;
  }

  findByChat(telegramChatId: string) {
    return this.prisma.designerProfile.findUnique({ where: { telegramChatId } });
  }

  /** What a designer sees about themselves, without the raw chat id. */
  async summary(userId: string) {
    const profile = await this.getByUser(userId);
    return {
      state: profile.state,
      telegramLinked: profile.telegramChatId !== null,
      telegramUsername: profile.telegramUsername,
    };
  }

  /** Paused designers receive nothing, and Busy ones work one task at a time. */
  listFree() {
    return this.prisma.designerProfile.findMany({
      where: { state: 'FREE' },
      orderBy: { createdAt: 'asc' },
    });
  }
}
