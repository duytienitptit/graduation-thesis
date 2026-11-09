import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { TaskChecksService } from './task-checks.service.js';
import { TaskDispatchService } from './task-dispatch.service.js';

export const DISPATCH_QUEUE = 'task-dispatch';
export const DAILY_DISPATCH_JOB = 'daily-dispatch';
export const TASK_CHECKS_JOB = 'task-checks';
export const TASK_CHECKS_EVERY_MS = 10 * 60 * 1000;

/**
 * Runs the dispatch at 09:00 Vietnam time every day, for tasks that waited overnight,
 * and the time-based task checks every 10 minutes.
 */
@Injectable()
export class DailyDispatchScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(DISPATCH_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      DAILY_DISPATCH_JOB,
      { pattern: '0 9 * * *', tz: 'Asia/Ho_Chi_Minh' },
      { name: DAILY_DISPATCH_JOB },
    );
    // Tests run the checks themselves with a fixed clock, over their own tasks only.
    if (this.config.get('TASK_CHECKS_ENABLED') === 'false') return;
    await this.queue.upsertJobScheduler(
      TASK_CHECKS_JOB,
      { every: TASK_CHECKS_EVERY_MS },
      { name: TASK_CHECKS_JOB },
    );
  }
}

@Processor(DISPATCH_QUEUE)
export class DailyDispatchProcessor extends WorkerHost {
  constructor(
    private readonly dispatcher: TaskDispatchService,
    private readonly checks: TaskChecksService,
  ) {
    super();
  }

  async process(job?: Job) {
    if (job?.name === TASK_CHECKS_JOB) await this.checks.run();
    else await this.dispatcher.dispatch();
  }
}

export const DAILY_DISPATCH_PROVIDERS = [DailyDispatchScheduler, DailyDispatchProcessor];
