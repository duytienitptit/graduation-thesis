import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ImageJobsService } from '../ai/image-jobs.service.js';
import { Clock } from '../common/clock.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskAccessService } from '../task/task-access.service.js';
import { TaskDispatchService } from '../task/task-dispatch.service.js';
import { TasksService } from '../task/tasks.service.js';
import { Answers, uploadedFileIds } from './answers.js';
import { DesignSessionService, SpecSnapshot } from './design-session.service.js';
import { buildBackPrompt, buildCloseUpPrompt, buildExtraViewPrompt } from './prompt-builder.js';
import { QUESTION_SETS } from './question-sets.js';

const GENERATED_VIEWS = ['BACK', 'CLOSE_UP'] as const;
const REQUIRED_VIEWS = ['FRONT', ...GENERATED_VIEWS] as const;
export const MAX_EXTRA_VIEWS = 2;

@Injectable()
export class DesignViewsService {
  private readonly logger = new Logger(DesignViewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DesignSessionService,
    private readonly jobs: ImageJobsService,
    private readonly files: FilesPort,
    private readonly access: TaskAccessService,
    private readonly tasks: TasksService,
    private readonly dispatcher: TaskDispatchService,
    private readonly clock: Clock,
  ) {}

  /**
   * The OK image becomes the front view, already approved because the customer chose it.
   * This ends free editing, and the other required views are started from it.
   */
  async chooseMain(customer: AuthUser, sessionId: string, versionId: string) {
    await this.sessions.getOwn(customer, sessionId);

    const version = await this.prisma.designVersion.findFirst({
      where: { id: versionId, sessionId },
    });
    if (!version) throw new NotFoundException('Version not found');

    const views = await this.prisma.$transaction(async (tx) => {
      const active = await tx.aiJob.count({
        where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active) throw new ConflictException('An image is still being created');

      const { count } = await tx.designSession.updateMany({
        where: { id: sessionId, status: 'ANSWERED' },
        data: { status: 'VIEWS' },
      });
      if (!count) throw new ConflictException('A main image cannot be chosen now');

      return this.createViews(tx, sessionId, versionId);
    });

    for (const type of GENERATED_VIEWS) {
      const view = views.find((candidate) => candidate.type === type)!;
      await this.generate(customer, sessionId, view.id).catch((error: unknown) => {
        // Out of credits: the view waits, and the customer starts it when credits return.
        if (!isDailyLimit(error)) throw error;
      });
    }
    return this.prisma.productView.findMany({ where: { sessionId } });
  }

  /**
   * The designer's "Done". Ending the task, freeing the designer and starting the views
   * are one transaction, so a designer can never stay Busy on a finished task.
   */
  async finishTask(designer: AuthUser, taskId: string) {
    const task = await this.access.openAs(designer, taskId, 'DESIGNER');

    const { views, finished } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.task.updateMany({
        where: {
          id: taskId,
          status: 'ASSIGNED',
          agreedVersionId: { not: null },
          finalVersionId: { not: null },
        },
        data: { status: 'DONE', doneAt: this.clock.now() },
      });
      if (!count) throw new ConflictException({ code: 'not-ready' });

      // A manager may have paused this designer meanwhile, which stays as it is.
      await tx.designerProfile.updateMany({
        where: { id: task.designerId!, state: 'BUSY' },
        data: { state: 'FREE' },
      });

      const moved = await tx.designSession.updateMany({
        where: { id: task.sessionId, status: 'DESIGNER' },
        data: { status: 'VIEWS' },
      });
      if (!moved.count) throw new ConflictException('This session is not with a designer');

      const finished = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      const views = await this.createViews(tx, task.sessionId, finished.finalVersionId!);
      return { views, finished };
    });

    const session = await this.prisma.designSession.findUniqueOrThrow({
      where: { id: finished.sessionId },
    });
    for (const view of views) {
      // The task is finished whatever happens here: a view left waiting has its own button.
      await this.startJob({ id: session.customerId }, session, view).catch((error: unknown) => {
        if (!isDailyLimit(error)) this.logger.warn(`View not started: ${String(error)}`);
      });
    }

    this.tasks.announce(task);
    await this.dispatcher.dispatch();
  }

  /** Starts a view that has no image yet, including after a failure or the daily limit. */
  async generate(customer: AuthUser, sessionId: string, viewId: string) {
    const { session, view } = await this.viewForChange(customer, sessionId, viewId);
    if (view.status !== 'PENDING') throw new ConflictException('This view already has an image');
    return this.startJob(customer, session, view);
  }

  /** Makes a new image for one unapproved view. Approved views are never touched. */
  async regenerate(customer: AuthUser, sessionId: string, viewId: string) {
    const { session, view } = await this.viewForChange(customer, sessionId, viewId);
    if (view.status !== 'READY') throw new ConflictException('Only a view waiting for approval');
    return this.startJob(customer, session, view);
  }

  async approve(customer: AuthUser, sessionId: string, viewId: string) {
    await this.viewForChange(customer, sessionId, viewId);
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.aiJob.count({
        where: { viewId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active) throw new ConflictException('A new image for this view is being created');

      const { count } = await tx.productView.updateMany({
        where: { id: viewId, status: 'READY' },
        data: { status: 'APPROVED' },
      });
      if (!count) throw new ConflictException('This view has no image to approve');
      return tx.productView.findUniqueOrThrow({ where: { id: viewId } });
    });
  }

  async addExtra(customer: AuthUser, sessionId: string, description: string) {
    const session = await this.changeableSession(customer, sessionId);
    const text = description.trim();
    if (!text) throw new BadRequestException('Description is empty');

    const taken = await this.prisma.productView.findMany({
      where: { sessionId, type: 'EXTRA' },
      select: { position: true },
    });
    if (taken.length >= MAX_EXTRA_VIEWS) throw new ConflictException('No more extra views');

    const position = taken.length + 1;
    const view = await this.prisma.productView
      .create({ data: { sessionId, type: 'EXTRA', position, description: text } })
      .catch(() => {
        throw new ConflictException('Another extra view was just added');
      });

    try {
      await this.startJob(customer, session, view);
    } catch (error) {
      // Nothing was made, so the slot goes back rather than sitting empty.
      await this.prisma.productView.delete({ where: { id: view.id } });
      throw error;
    }
    return view;
  }

  async lock(customer: AuthUser, sessionId: string) {
    await this.changeableSession(customer, sessionId);

    return this.prisma.$transaction(async (tx) => {
      const active = await tx.aiJob.count({
        where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active) throw new ConflictException('An image is still being created');

      const approved = await tx.productView.count({
        where: { sessionId, type: { in: [...REQUIRED_VIEWS] }, status: 'APPROVED' },
      });
      if (approved < REQUIRED_VIEWS.length) {
        throw new ConflictException('All required views must be approved');
      }

      const { count } = await tx.designSession.updateMany({
        where: { id: sessionId, status: 'VIEWS' },
        data: { status: 'LOCKED' },
      });
      if (!count) throw new ConflictException('This product is already locked');

      return tx.lockedProduct.create({ data: { sessionId } });
    });
  }

  /** Everything Person 1 needs, in one format for both branches. */
  async getLocked(user: AuthUser, id: string) {
    const locked = await this.prisma.lockedProduct.findUnique({
      where: { id },
      include: {
        session: {
          include: {
            views: {
              where: { status: 'APPROVED' },
              orderBy: [{ type: 'asc' }, { position: 'asc' }],
              include: { version: true },
            },
          },
        },
      },
    });
    if (!locked) throw new NotFoundException();

    const { session } = locked;
    if (session.customerId !== user.id && user.role !== Role.MANAGER) {
      throw new ForbiddenException();
    }

    const specs = session.specSnapshot as unknown as SpecSnapshot;
    const answers = session.answers as unknown as Answers;
    const uploads = uploadedFileIds(QUESTION_SETS[specs.product.shirtType], answers);
    const front = session.views.find((view) => view.type === 'FRONT');

    return {
      id: locked.id,
      sessionId: session.id,
      customerId: session.customerId,
      lockedAt: locked.lockedAt,
      source: front?.version?.source,
      product: specs,
      answers,
      views: await Promise.all(
        session.views.map(async (view) => ({
          type: view.type,
          position: view.position,
          description: view.description,
          source: view.version!.source,
          fileId: view.version!.fileId,
          imageUrl: (await this.files.getLink(view.version!.fileId)).url,
        })),
      ),
      uploads: await Promise.all(
        uploads.map(async (fileId) => ({
          fileId,
          url: (await this.files.getLink(fileId)).url,
        })),
      ),
    };
  }

  /** The main image is approved already, because the customer chose or agreed to it. */
  private async createViews(tx: Prisma.TransactionClient, sessionId: string, versionId: string) {
    await tx.productView.create({
      data: { sessionId, type: 'FRONT', versionId, status: 'APPROVED' },
    });
    return Promise.all(
      GENERATED_VIEWS.map((type) => tx.productView.create({ data: { sessionId, type } })),
    );
  }

  private async changeableSession(customer: AuthUser, sessionId: string) {
    const session = await this.sessions.getOwn(customer, sessionId);
    if (session.status !== 'VIEWS') throw new ConflictException('Views cannot be changed now');
    return session;
  }

  private async viewForChange(customer: AuthUser, sessionId: string, viewId: string) {
    const session = await this.changeableSession(customer, sessionId);
    const view = await this.prisma.productView.findFirst({ where: { id: viewId, sessionId } });
    if (!view) throw new NotFoundException('View not found');
    return { session, view };
  }

  /** The back content of the task whose final is this front view, if it came from a designer. */
  private async designerBack(sessionId: string, frontVersionId: string) {
    const task = await this.prisma.task.findFirst({
      where: { sessionId, finalVersionId: frontVersionId },
    });
    return task ? { description: task.backDescription, fileId: task.backFileId } : undefined;
  }

  private async startJob(
    customer: { id: string },
    session: { id: string; answers: unknown },
    view: { id: string; type: string; description: string | null },
  ) {
    const front = await this.prisma.productView.findFirstOrThrow({
      where: { sessionId: session.id, type: 'FRONT' },
    });
    const answers = session.answers as Answers;
    const built =
      view.type === 'BACK'
        ? buildBackPrompt(answers, await this.designerBack(session.id, front.versionId!))
        : view.type === 'CLOSE_UP'
          ? buildCloseUpPrompt(answers)
          : buildExtraViewPrompt(view.description ?? '');

    return this.jobs.enqueue({
      sessionId: session.id,
      customerId: customer.id,
      kind: 'VIEW',
      viewId: view.id,
      parentVersionId: front.versionId!,
      ...built,
    });
  }
}

function isDailyLimit(error: unknown) {
  return error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
}
