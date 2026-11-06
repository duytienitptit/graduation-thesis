import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { DesignersService } from '../task/designers.service.js';
import { TasksService } from '../task/tasks.service.js';
import { ClaimOutcome, registerHandlers } from './telegram-handlers.js';
import { TelegramLinkService } from './telegram-link.service.js';

@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Bot | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly links: TelegramLinkService,
    private readonly designers: DesignersService,
    private readonly tasks: TasksService,
  ) {}

  get enabled() {
    return this.config.get('TELEGRAM_ENABLED') === 'true';
  }

  /** Known once the bot has connected; null when it is off. */
  get username() {
    return this.bot?.isInited() ? this.bot.botInfo.username : null;
  }

  sendPhoto(
    chatId: string,
    photo: Buffer,
    options: { caption: string; reply_markup: InlineKeyboard },
  ) {
    if (!this.bot) throw new Error('Telegram bot is not running');
    return this.bot.api.sendPhoto(chatId, new InputFile(photo, 'mau.jpg'), options);
  }

  /** Replaces a notice and drops its button. Editing without a markup removes the markup. */
  async replaceNotice(chatId: string, messageId: number, text: string) {
    if (!this.bot) throw new Error('Telegram bot is not running');
    await this.bot.api.editMessageCaption(chatId, messageId, { caption: text });
  }

  /** The chat id of a private chat is the Telegram user id, which is what buttons report. */
  async claim(chatId: string, taskId: string): Promise<ClaimOutcome> {
    const designer = await this.designers.findByChat(chatId);
    if (!designer) return 'not-linked';
    const result = await this.tasks.claim(designer.id, taskId);
    return result.ok ? 'claimed' : result.reason;
  }

  async onApplicationBootstrap() {
    if (!this.enabled) return;

    const bot = new Bot(this.config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'));
    registerHandlers(bot, {
      link: (code, chatId, username) => this.links.link(code, chatId, username),
      claim: (chatId, taskId) => this.claim(chatId, taskId),
    });
    bot.catch((error) => this.logger.error(`Telegram update failed: ${error.message}`));
    this.bot = bot;

    // Long polling. A Telegram problem must not stop the rest of the API from starting.
    void bot
      .start({
        drop_pending_updates: false,
        onStart: (info) => this.logger.log(`Telegram bot @${info.username} is listening`),
      })
      .catch((error: Error) => this.logger.error(`Telegram bot stopped: ${error.message}`));
  }

  async onApplicationShutdown() {
    await this.bot?.stop();
  }
}
