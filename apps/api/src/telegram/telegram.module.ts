import { Module } from '@nestjs/common';
import { FilesModule } from '../integrations/files/files.module.js';
import { TaskModule } from '../task/task.module.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { TelegramLinkService } from './telegram-link.service.js';
import { TelegramNoticeProcessor } from './telegram-notice.processor.js';
import { TelegramController } from './telegram.controller.js';

@Module({
  imports: [FilesModule, TaskModule],
  controllers: [TelegramController],
  providers: [TelegramBotService, TelegramLinkService, TelegramNoticeProcessor],
  exports: [TelegramBotService],
})
export class TelegramModule {}
