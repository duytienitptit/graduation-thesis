import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Clock } from '../common/clock.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { IMAGE_JOB_ATTEMPTS, IMAGE_QUEUE } from './image-jobs.service.js';
import { ImageProvider, ImageProviderError } from './image-provider.js';

export const IMAGE_JOB_EVENT = 'design.image-job';

@Processor(IMAGE_QUEUE, { concurrency: 3 })
export class ImageProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: ImageProvider,
    private readonly files: FilesPort,
    private readonly realtime: RealtimeGateway,
    private readonly clock: Clock,
  ) {
    super();
  }

  async process(queued: Job<{ aiJobId: string }>) {
    const job = await this.prisma.aiJob.findUnique({ where: { id: queued.data.aiJobId } });
    if (!job || job.status === 'DONE' || job.status === 'FAILED') return;

    const started = Date.now();
    await this.prisma.aiJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING', attempts: { increment: 1 } },
    });
    this.notify(job, 'RUNNING');

    try {
      const parent = job.parentVersionId
        ? await this.prisma.designVersion.findUniqueOrThrow({
            where: { id: job.parentVersionId },
          })
        : null;
      const fileIds = [...(parent ? [parent.fileId] : []), ...job.referenceFileIds];
      const images = await Promise.all(fileIds.map((id) => this.files.readImage(id)));

      const result = await this.provider.generate({ prompt: job.prompt, images });
      const fileId = await this.files.saveImage(job.customerId, result.image);

      await this.prisma.$transaction(async (tx) => {
        const version = await tx.designVersion.create({
          data: {
            sessionId: job.sessionId,
            parentVersionId: job.parentVersionId,
            fileId,
            source: 'AI',
            prompt: job.prompt,
          },
        });
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: 'DONE',
            versionId: version.id,
            model: result.model,
            costUsd: result.costUsd,
            durationMs: Date.now() - started,
            error: null,
            finishedAt: this.clock.now(),
          },
        });
        if (job.viewId) {
          await tx.productView.update({
            where: { id: job.viewId },
            data: { versionId: version.id, status: 'READY' },
          });
        }
      });
      this.notify(job, 'DONE');
    } catch (error) {
      const retryable = !(error instanceof ImageProviderError) || error.retryable;
      const message = error instanceof Error ? error.message : String(error);

      if (retryable && queued.attemptsMade + 1 < IMAGE_JOB_ATTEMPTS) {
        await this.prisma.aiJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', error: message },
        });
        throw error;
      }

      await this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error: message,
          durationMs: Date.now() - started,
          finishedAt: this.clock.now(),
        },
      });
      this.notify(job, 'FAILED');
      throw new UnrecoverableError(message);
    }
  }

  /** Only a nudge: the page reloads its state, so a missed event loses nothing. */
  private notify(job: { id: string; sessionId: string; customerId: string }, status: string) {
    this.realtime.emitToUser(job.customerId, IMAGE_JOB_EVENT, {
      jobId: job.id,
      sessionId: job.sessionId,
      status,
    });
  }
}
