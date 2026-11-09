import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { workingMsBetween } from '../common/vietnam-time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { TasksService } from './tasks.service.js';

const HOUR_MS = 60 * 60 * 1000;
export const NO_TAKER_AFTER_WORKING_MS = 2 * HOUR_MS;
export const SILENCE_AFTER_MS = 24 * HOUR_MS;
export const TASK_ALERT_EVENT = 'task.alert';

interface SilenceTask {
  assignedAt: Date | null;
  agreedAt: Date | null;
  customerId: string;
  designer: { userId: string } | null;
  messages: { senderId: string; createdAt: Date }[];
}

/**
 * Since when the customer has been waiting for the designer, or null when it is the
 * customer's turn. Before the designer writes anything, the wait starts at the claim.
 */
export function waitingForDesignerSince(task: SilenceTask) {
  const designerId = task.designer?.userId;
  const lastDesigner = task.messages
    .filter((message) => message.senderId === designerId)
    .at(-1)?.createdAt;
  if (!lastDesigner) return task.assignedAt;

  const after = (time: Date | null | undefined) => !!time && time > lastDesigner;
  const customerActs = [
    ...task.messages
      .filter((message) => message.senderId === task.customerId && after(message.createdAt))
      .map((message) => message.createdAt),
    ...(after(task.agreedAt) ? [task.agreedAt!] : []),
  ];
  if (!customerActs.length) return null;
  return new Date(Math.min(...customerActs.map((time) => time.getTime())));
}

/** Time-based task rules. A scheduled job runs them every 10 minutes. */
@Injectable()
export class TaskChecksService {
  private readonly logger = new Logger(TaskChecksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimeGateway,
    private readonly clock: Clock,
  ) {}

  /** `scope` lets tests that share the database check only their own tasks. */
  async run(scope: Prisma.TaskWhereInput = {}) {
    await this.noTakerNotices(scope);
    await this.silenceAlerts(scope);
  }

  /** Tells the customer once when nobody took the task within 2 working hours of the first message. */
  async noTakerNotices(scope: Prisma.TaskWhereInput = {}) {
    const now = this.clock.now();
    const tasks = await this.prisma.task.findMany({
      where: { ...scope, status: 'WAITING', noTakerNoticeAt: null },
      include: { notices: { orderBy: { sentAt: 'asc' }, take: 1 } },
    });

    for (const task of tasks) {
      const first = task.notices[0];
      if (!first || workingMsBetween(first.sentAt, now) < NO_TAKER_AFTER_WORKING_MS) continue;

      const { count } = await this.prisma.task.updateMany({
        where: { id: task.id, status: 'WAITING', noTakerNoticeAt: null },
        data: { noTakerNoticeAt: now },
      });
      if (count) this.tasks.announce(task);
    }
  }

  /** Alerts managers once per silence; the designer's next message clears the alert. */
  async silenceAlerts(scope: Prisma.TaskWhereInput = {}) {
    const now = this.clock.now();
    const tasks = await this.prisma.task.findMany({
      where: { ...scope, status: 'ASSIGNED', silenceAlertAt: null },
      include: {
        designer: true,
        messages: { orderBy: { createdAt: 'asc' }, select: { senderId: true, createdAt: true } },
      },
    });

    const managers = await this.prisma.user.findMany({
      where: { role: 'MANAGER' },
      select: { id: true },
    });
    for (const task of tasks) {
      const since = waitingForDesignerSince(task);
      if (!since || now.getTime() - since.getTime() < SILENCE_AFTER_MS) continue;

      const { count } = await this.prisma.task.updateMany({
        where: { id: task.id, status: 'ASSIGNED', silenceAlertAt: null },
        data: { silenceAlertAt: now },
      });
      if (!count) continue;

      this.logger.warn(`Designer silent on task ${task.id} since ${since.toISOString()}`);
      for (const manager of managers) {
        this.realtime.emitToUser(manager.id, TASK_ALERT_EVENT, {
          taskId: task.id,
          kind: 'designer-silent',
          since,
        });
      }
    }
  }
}
