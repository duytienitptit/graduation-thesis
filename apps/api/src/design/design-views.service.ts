import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImageJobsService } from '../ai/image-jobs.service.js';
import { Role } from '../generated/prisma/enums.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Answers, uploadedFileIds } from './answers.js';
import { DesignSessionService, SpecSnapshot } from './design-session.service.js';
import { buildBackPrompt, buildCloseUpPrompt, buildExtraViewPrompt } from './prompt-builder.js';
import { QUESTION_SETS } from './question-sets.js';

const GENERATED_VIEWS = ['BACK', 'CLOSE_UP'] as const;
const REQUIRED_VIEWS = ['FRONT', ...GENERATED_VIEWS] as const;
export const MAX_EXTRA_VIEWS = 2;

@Injectable()
export class DesignViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: DesignSessionService,
    private readonly jobs: ImageJobsService,
    private readonly files: FilesPort,
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

      await tx.productView.create({
        data: { sessionId, type: 'FRONT', versionId, status: 'APPROVED' },
      });
      return Promise.all(
        GENERATED_VIEWS.map((type) => tx.productView.create({ data: { sessionId, type } })),
      );
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
          imageUrl: (await this.files.getDownloadLink(user, view.version!.fileId)).url,
        })),
      ),
      uploads: await Promise.all(
        uploads.map(async (fileId) => ({
          fileId,
          url: (await this.files.getDownloadLink(user, fileId)).url,
        })),
      ),
    };
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

  private async startJob(
    customer: AuthUser,
    session: { id: string; answers: unknown },
    view: { id: string; type: string; description: string | null },
  ) {
    const front = await this.prisma.productView.findFirstOrThrow({
      where: { sessionId: session.id, type: 'FRONT' },
    });
    const answers = session.answers as Answers;
    const built =
      view.type === 'BACK'
        ? buildBackPrompt(answers)
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
