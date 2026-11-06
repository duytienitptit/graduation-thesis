import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImageJobsService } from '../ai/image-jobs.service.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TasksService } from '../task/tasks.service.js';
import { Answers } from './answers.js';
import { DesignSessionService, SpecSnapshot } from './design-session.service.js';
import { buildEditPrompt, buildFirstImagePrompt } from './prompt-builder.js';

@Injectable()
export class DesignImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DesignSessionService,
    private readonly jobs: ImageJobsService,
    private readonly files: FilesPort,
    private readonly tasks: TasksService,
  ) {}

  /** Starting over is allowed only until a first image exists; after that it is an edit. */
  async createFirst(customer: AuthUser, sessionId: string) {
    const session = await this.sessions.getOwn(customer, sessionId);
    if (session.status !== 'ANSWERED') throw new ConflictException('Answers are not submitted');

    const versions = await this.prisma.designVersion.count({ where: { sessionId } });
    if (versions) throw new ConflictException('This session already has an image');

    const built = buildFirstImagePrompt(
      session.specSnapshot as unknown as SpecSnapshot,
      session.answers as unknown as Answers,
    );
    return this.jobs.enqueue({
      sessionId,
      customerId: customer.id,
      kind: 'CREATE',
      ...built,
    });
  }

  async edit(customer: AuthUser, sessionId: string, versionId: string, request: string) {
    const session = await this.sessions.getOwn(customer, sessionId);
    if (session.status !== 'ANSWERED') {
      throw new ConflictException('The main image is already chosen');
    }
    const parent = await this.prisma.designVersion.findFirst({
      where: { id: versionId, sessionId },
    });
    if (!parent) throw new NotFoundException('Version not found');

    const editRequest = request.trim();
    if (!editRequest) throw new BadRequestException('Edit request is empty');

    const { referenceFileIds } = buildFirstImagePrompt(
      session.specSnapshot as unknown as SpecSnapshot,
      session.answers as unknown as Answers,
    );
    return this.jobs.enqueue({
      sessionId,
      customerId: customer.id,
      kind: 'EDIT',
      prompt: buildEditPrompt(editRequest),
      referenceFileIds,
      parentVersionId: parent.id,
      editRequest,
    });
  }

  /** Everything the screen needs, so it can reload after any missed live event. */
  async workspace(user: AuthUser, sessionId: string) {
    const session = await this.sessions.get(user, sessionId);
    const [versions, latestJob, usage, views, locked, task] = await Promise.all([
      this.prisma.designVersion.findMany({
        // View images belong to their view, not to the editing history.
        where: { sessionId, NOT: { aiJob: { kind: 'VIEW' } } },
        orderBy: { createdAt: 'asc' },
        include: { aiJob: { select: { editRequest: true } } },
      }),
      this.prisma.aiJob.findFirst({
        where: { sessionId, kind: { not: 'VIEW' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, kind: true },
      }),
      this.jobs.usage(session.customerId),
      this.prisma.productView.findMany({
        where: { sessionId },
        orderBy: [{ type: 'asc' }, { position: 'asc' }],
        include: {
          version: { select: { fileId: true } },
          aiJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } },
        },
      }),
      this.prisma.lockedProduct.findUnique({ where: { sessionId }, select: { id: true } }),
      this.tasks.forSession(sessionId),
    ]);

    return {
      status: session.status,
      lockedProductId: locked?.id ?? null,
      task,
      versions: await Promise.all(
        versions.map(async (version) => ({
          id: version.id,
          parentVersionId: version.parentVersionId,
          source: version.source,
          editRequest: version.aiJob?.editRequest ?? null,
          createdAt: version.createdAt,
          imageUrl: (await this.files.getDownloadLink(user, version.fileId)).url,
        })),
      ),
      latestJob,
      usage,
      views: await Promise.all(
        views.map(async (view) => ({
          id: view.id,
          type: view.type,
          position: view.position,
          status: view.status,
          description: view.description,
          versionId: view.versionId,
          jobStatus: view.aiJobs[0]?.status ?? null,
          imageUrl: view.version
            ? (await this.files.getDownloadLink(user, view.version.fileId)).url
            : null,
        })),
      ),
    };
  }
}
