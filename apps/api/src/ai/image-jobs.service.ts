import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { Clock } from '../common/clock.js';
import { nextVietnamMidnight, startOfVietnamDay } from '../common/vietnam-time.js';
import { AiJobKind } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const IMAGE_QUEUE = 'ai-images';
export const DAILY_IMAGE_LIMIT = 20;
export const IMAGE_JOB_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;

export interface ImageJobRequest {
  sessionId: string;
  customerId: string;
  kind: AiJobKind;
  prompt: string;
  referenceFileIds: string[];
  parentVersionId?: string;
  editRequest?: string;
  viewId?: string;
}

@Injectable()
export class ImageJobsService {
  constructor(
    @InjectQueue(IMAGE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly config: ConfigService,
  ) {}

  /** Failed jobs are not counted, so a failure never uses up the limit. */
  async usage(customerId: string) {
    const now = this.clock.now();
    const used = await this.countToday(this.prisma, customerId, now);
    return {
      used,
      limit: DAILY_IMAGE_LIMIT,
      remaining: Math.max(0, DAILY_IMAGE_LIMIT - used),
      resetsAt: nextVietnamMidnight(now),
    };
  }

  async enqueue(request: ImageJobRequest) {
    const now = this.clock.now();
    const job = await this.prisma.$transaction(async (tx) => {
      // One request per customer at a time, so parallel requests cannot pass the limit together.
      await tx.$queryRaw`select pg_advisory_xact_lock(hashtext(${request.customerId}::text))::text`;

      const used = await this.countToday(tx, request.customerId, now);
      if (used >= DAILY_IMAGE_LIMIT) {
        throw new HttpException(
          { code: 'daily-limit', resetsAt: nextVietnamMidnight(now) },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Views run side by side; anything else is one job at a time per session.
      const scope = request.viewId
        ? { viewId: request.viewId }
        : { sessionId: request.sessionId };
      const active = await tx.aiJob.count({
        where: { ...scope, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active) throw new ConflictException('An image is already being created');

      return tx.aiJob.create({ data: { ...request, createdAt: now } });
    });

    try {
      await this.queue.add(
        'generate',
        { aiJobId: job.id },
        {
          jobId: job.id,
          attempts: IMAGE_JOB_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: Number(this.config.get('AI_RETRY_DELAY_MS') ?? DEFAULT_RETRY_DELAY_MS),
          },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch {
      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: 'Queue unavailable', finishedAt: this.clock.now() },
      });
      throw new ServiceUnavailableException('Image queue is unavailable');
    }
    return job;
  }

  private countToday(
    db: Pick<PrismaService, 'aiJob'>,
    customerId: string,
    now: Date,
  ) {
    return db.aiJob.count({
      where: {
        customerId,
        status: { not: 'FAILED' },
        createdAt: { gte: startOfVietnamDay(now) },
      },
    });
  }
}
