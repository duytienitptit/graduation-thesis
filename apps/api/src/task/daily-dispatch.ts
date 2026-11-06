import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TaskDispatchService } from './task-dispatch.service.js';

export const DISPATCH_QUEUE = 'task-dispatch';

/** Runs the dispatch at 09:00 Vietnam time every day, for tasks that waited overnight. */
@Injectable()
export class DailyDispatchScheduler implements OnModuleInit {
  constructor(@InjectQueue(DISPATCH_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler('daily-dispatch', {
      pattern: '0 9 * * *',
      tz: 'Asia/Ho_Chi_Minh',
    });
  }
}

@Processor(DISPATCH_QUEUE)
export class DailyDispatchProcessor extends WorkerHost {
  constructor(private readonly dispatcher: TaskDispatchService) {
    super();
  }

  async process() {
    await this.dispatcher.dispatch();
  }
}

export const DAILY_DISPATCH_PROVIDERS = [DailyDispatchScheduler, DailyDispatchProcessor];
