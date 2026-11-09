import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { isWorkingHours } from '../common/vietnam-time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { TaskAccessService } from './task-access.service.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskNoticeSender } from './task-notice-sender.js';

export const TASK_EVENT = 'design.task';
export const CANCEL_AFTER_MS = 48 * 60 * 60 * 1000;
export const OPEN_TASK_STATUSES = ['WAITING', 'ASSIGNED'] as const;

/** Only one change at a time per session, so a view task and locking cannot cross. */
export const lockSession = (tx: Prisma.TransactionClient, sessionId: string) =>
  tx.$queryRaw`select pg_advisory_xact_lock(hashtext(${`session:${sessionId}`}::text))::text`;

type SummaryTask = Prisma.TaskGetPayload<{
  include: { designer: { include: { user: { select: { name: true } } } } };
}>;

export type ClaimResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: 'already-taken' | 'designer-busy' };

class ClaimRefused extends Error {
  constructor(readonly reason: 'already-taken' | 'designer-busy') {
    super(reason);
  }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: TaskDispatchService,
    private readonly sender: TaskNoticeSender,
    private readonly realtime: RealtimeGateway,
    private readonly access: TaskAccessService,
    private readonly clock: Clock,
  ) {}

  /** Moves the session to the designer branch, which ends AI editing while it waits. */
  async create(customer: AuthUser, sessionId: string, versionId: string, requirement: string) {
    const session = await this.prisma.designSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.customerId !== customer.id) throw new ForbiddenException();

    const version = await this.prisma.designVersion.findFirst({
      where: { id: versionId, sessionId, source: 'AI' },
    });
    if (!version) throw new NotFoundException('An AI image is needed first');

    const task = await this.prisma.$transaction(async (tx) => {
      const active = await tx.aiJob.count({
        where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (active) throw new ConflictException('An image is still being created');

      const { count } = await tx.designSession.updateMany({
        where: { id: sessionId, status: 'ANSWERED' },
        data: { status: 'DESIGNER' },
      });
      if (!count) throw new ConflictException('A task cannot be created now');

      return tx.task.create({
        data: {
          sessionId,
          customerId: customer.id,
          requirement: requirement.trim(),
          referenceVersionId: versionId,
          createdAt: this.clock.now(),
        },
      });
    });

    await this.dispatcher.dispatch();
    return task;
  }

  /**
   * Asks a designer for one view the AI did not get right. The front is the main image,
   * so it is sent along and cannot be the target.
   */
  async createForView(customer: AuthUser, sessionId: string, viewId: string, requirement: string) {
    const session = await this.prisma.designSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    if (session.customerId !== customer.id) throw new ForbiddenException();

    const task = await this.prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const current = await tx.designSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (current.status !== 'VIEWS') throw new ConflictException('Views cannot be changed now');

      const view = await tx.productView.findFirst({ where: { id: viewId, sessionId } });
      if (!view) throw new NotFoundException('View not found');
      if (view.type === 'FRONT') throw new ConflictException({ code: 'front-view' });
      if (view.status === 'APPROVED') throw new ConflictException({ code: 'view-approved' });

      const busy = await tx.aiJob.count({
        where: { viewId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (busy) throw new ConflictException('An image for this view is being created');
      const open = await tx.task.count({
        where: { targetViewId: viewId, status: { in: [...OPEN_TASK_STATUSES] } },
      });
      if (open) throw new ConflictException({ code: 'view-with-designer' });

      const front = await tx.productView.findFirstOrThrow({
        where: { sessionId, type: 'FRONT' },
      });
      return tx.task.create({
        data: {
          sessionId,
          customerId: customer.id,
          requirement: requirement.trim(),
          referenceVersionId: front.versionId!,
          targetViewId: viewId,
          createdAt: this.clock.now(),
        },
      });
    });

    await this.dispatcher.dispatch();
    return task;
  }

  /** Only after 48 hours untaken; once taken, cancelling belongs to the manager. */
  async cancel(customer: AuthUser, taskId: string) {
    const task = await this.access.openAs(customer, taskId, 'CUSTOMER');
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.task.updateMany({
        where: {
          id: taskId,
          status: 'WAITING',
          createdAt: { lte: new Date(now.getTime() - CANCEL_AFTER_MS) },
        },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      if (!count) {
        throw new ConflictException({ code: task.status === 'WAITING' ? 'too-early' : 'not-waiting' });
      }
      await this.reopenSession(tx, task);
    });

    const notices = await this.prisma.taskNotice.findMany({
      where: { taskId },
      select: { id: true },
    });
    await this.sender.markTaken(task, notices, 'cancelled');
    this.announce(task);
  }

  /** The designer ends a task early, usually because the customer went silent. */
  async close(designerUser: AuthUser, taskId: string, reason: string) {
    const task = await this.access.openAs(designerUser, taskId, 'DESIGNER');
    const closeReason = reason.trim();
    if (!closeReason) throw new BadRequestException('A reason is needed');

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.task.updateMany({
        where: { id: taskId, status: 'ASSIGNED' },
        data: { status: 'CLOSED', closedAt: this.clock.now(), closeReason },
      });
      if (!count) throw new ConflictException('This task is not open');

      // A manager may have paused this designer meanwhile, which stays as it is.
      await tx.designerProfile.updateMany({
        where: { id: task.designerId!, state: 'BUSY' },
        data: { state: 'FREE' },
      });
      await this.reopenSession(tx, task);
    });

    this.announce(task);
    await this.dispatcher.dispatch();
  }

  /**
   * A whole-shirt task gives the session back to AI editing, where a new task can also
   * be made. A view task never moved the session, which stays at the views step.
   */
  private async reopenSession(
    tx: Prisma.TransactionClient,
    task: { sessionId: string; targetViewId: string | null },
  ) {
    if (task.targetViewId) return;
    await tx.designSession.updateMany({
      where: { id: task.sessionId, status: 'DESIGNER' },
      data: { status: 'ANSWERED' },
    });
  }

  /**
   * The first press wins. Both conditional updates run in one transaction, so the
   * check and the assignment cannot be separated by another press.
   */
  async claim(designerId: string, taskId: string): Promise<ClaimResult> {
    let task;
    try {
      task = await this.prisma.$transaction(async (tx) => {
        const designer = await tx.designerProfile.updateMany({
          where: { id: designerId, state: 'FREE' },
          data: { state: 'BUSY' },
        });
        if (!designer.count) throw new ClaimRefused('designer-busy');

        const assigned = await tx.task.updateMany({
          where: { id: taskId, status: 'WAITING' },
          data: { status: 'ASSIGNED', designerId, assignedAt: this.clock.now() },
        });
        // Throwing rolls back the designer, who stays Free.
        if (!assigned.count) throw new ClaimRefused('already-taken');

        return tx.task.findUniqueOrThrow({
          where: { id: taskId },
          include: { designer: true },
        });
      });
    } catch (error) {
      if (error instanceof ClaimRefused) return { ok: false, reason: error.reason };
      throw error;
    }

    const others = await this.prisma.taskNotice.findMany({
      where: { taskId, designerId: { not: designerId } },
      select: { id: true },
    });
    await this.sender.markTaken(task, others);
    this.announce(task);
    return { ok: true, taskId };
  }

  /** Only a nudge: both pages reload the task, so a missed event loses nothing. */
  announce(task: {
    id: string;
    sessionId: string;
    customerId: string;
    designer?: { userId: string } | null;
  }) {
    const event = { sessionId: task.sessionId, taskId: task.id };
    this.realtime.emitToUser(task.customerId, TASK_EVENT, event);
    if (task.designer) this.realtime.emitToUser(task.designer.userId, TASK_EVENT, event);
  }

  /** A designer who becomes free receives every waiting task. */
  async setFree(designerId: string) {
    await this.prisma.designerProfile.update({
      where: { id: designerId },
      data: { state: 'FREE' },
    });
    await this.dispatcher.dispatch();
  }

  /** The customer's latest whole-shirt task. View tasks belong to their views. */
  async forSession(sessionId: string) {
    const task = await this.prisma.task.findFirst({
      where: { sessionId, targetViewId: null },
      orderBy: { createdAt: 'desc' },
      include: { designer: { include: { user: { select: { name: true } } } } },
    });
    return task ? this.summary(task) : null;
  }

  /** The latest task of each view that has had one, by view id. */
  async forViews(sessionId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { sessionId, targetViewId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { designer: { include: { user: { select: { name: true } } } } },
    });
    const latest = new Map<string, SummaryTask>();
    for (const task of tasks) {
      if (!latest.has(task.targetViewId!)) latest.set(task.targetViewId!, task);
    }
    const entries = await Promise.all(
      [...latest].map(async ([viewId, task]) => [viewId, await this.summary(task)] as const),
    );
    return Object.fromEntries(entries);
  }

  /** What the customer sees about a task. */
  private async summary(task: SummaryTask) {
    const waiting = task.status === 'WAITING';
    const free = waiting
      ? await this.prisma.designerProfile.count({ where: { state: 'FREE' } })
      : 0;
    return {
      id: task.id,
      status: task.status,
      requirement: task.requirement,
      createdAt: task.createdAt,
      designerName: task.designer?.user.name ?? null,
      waitReason: !waiting
        ? null
        : !isWorkingHours(this.clock.now())
          ? 'out-of-hours'
          : free === 0
            ? 'no-free-designer'
            : null,
      noTakerNotice: waiting && task.noTakerNoticeAt !== null,
      cancellableAt: new Date(task.createdAt.getTime() + CANCEL_AFTER_MS),
      closeReason: task.closeReason,
    };
  }
}
