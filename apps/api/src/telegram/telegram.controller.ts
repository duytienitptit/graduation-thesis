import { Controller, Post, ServiceUnavailableException } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { DesignersService } from '../task/designers.service.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramLinkService } from './telegram-link.service.js';

@Controller('designers/me/telegram-link')
export class TelegramController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly links: TelegramLinkService,
    private readonly designers: DesignersService,
  ) {}

  @Roles(Role.DESIGNER)
  @Post()
  async create(@CurrentUser() user: AuthUser) {
    const username = this.bot.username;
    if (!username) throw new ServiceUnavailableException('Telegram bot is not running');

    const designer = await this.designers.getByUser(user.id);
    const { code, expiresAt } = await this.links.createCode(designer.id);
    return { url: `https://t.me/${username}?start=${code}`, expiresAt };
  }
}
