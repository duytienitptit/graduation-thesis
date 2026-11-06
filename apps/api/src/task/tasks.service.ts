import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { isWorkingHours } from '../common/vietnam-time.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { TaskNoticeSender } from './task-notice-sender.js';

export const TASK_EVENT = 'design.task';

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

        return tx.task.findUniqueOrThrow({ where: { id: taskId } });
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
    this.realtime.emitToUser(task.customerId, TASK_EVENT, {
      sessionId: task.sessionId,
      status: task.status,
    });
    return { ok: true, taskId };
  }

  /** A designer who becomes free receives every waiting task. */
  async setFree(designerId: string) {
    await this.prisma.designerProfile.update({
      where: { id: designerId },
      data: { state: 'FREE' },
    });
    await this.dispatcher.dispatch();
  }

  /** What the customer sees while the task is open. */
  async forSession(sessionId: string) {
    const task = await this.prisma.task.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      include: { designer: { include: { user: { select: { name: true } } } } },
    });
    if (!task) return null;

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
    };
  }
}
