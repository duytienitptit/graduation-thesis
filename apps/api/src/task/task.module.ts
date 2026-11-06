import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RealtimeModule } from '../realtime/realtime.module.js';
import {
  DAILY_DISPATCH_PROVIDERS,
  DISPATCH_QUEUE,
} from './daily-dispatch.js';
import { DesignersController } from './designers.controller.js';
import { DesignersService } from './designers.service.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { FakeTaskNoticeSender, TaskNoticeSender } from './task-notice-sender.js';
import { NOTICE_QUEUE, QueuedTelegramSender } from './queued-telegram-sender.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: DISPATCH_QUEUE }, { name: NOTICE_QUEUE }),
    RealtimeModule,
  ],
  controllers: [DesignersController, TasksController],
  providers: [
    DesignersService,
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
  exports: [DesignersService, TasksService, TaskDispatchService, BullModule],
})
export class TaskModule {}
