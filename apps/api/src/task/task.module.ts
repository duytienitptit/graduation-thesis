import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FilesModule } from '../integrations/files/files.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import {
  DAILY_DISPATCH_PROVIDERS,
  DISPATCH_QUEUE,
} from './daily-dispatch.js';
import { DesignersController } from './designers.controller.js';
import { DesignersService } from './designers.service.js';
import { TaskAccessService } from './task-access.service.js';
import { TaskChecksService } from './task-checks.service.js';
import { TaskDetailsService } from './task-details.service.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { FakeTaskNoticeSender, TaskNoticeSender } from './task-notice-sender.js';
import { NOTICE_QUEUE, QueuedTelegramSender } from './queued-telegram-sender.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: DISPATCH_QUEUE }, { name: NOTICE_QUEUE }),
    FilesModule,
    RealtimeModule,
  ],
  controllers: [DesignersController, TasksController],
  providers: [
    DesignersService,
    TaskAccessService,
    TaskChecksService,
    TaskDetailsService,
    TaskDispatchService,
    TasksService,
    {
      provide: TaskNoticeSender,
      inject: [ConfigService, getQueueToken(NOTICE_QUEUE)],
      useFactory: (config: ConfigService, queue: Queue) =>
        config.get('TELEGRAM_ENABLED') === 'true'
          ? new QueuedTelegramSender(queue)
          : new FakeTaskNoticeSender(),
    },
    ...DAILY_DISPATCH_PROVIDERS,
  ],
  exports: [
    DesignersService,
    TaskAccessService,
    TaskChecksService,
    TasksService,
    TaskDispatchService,
    TaskNoticeSender,
    BullModule,
  ],
})
export class TaskModule {}
