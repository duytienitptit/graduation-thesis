import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { isWorkingHours, vietnamDayKey } from '../common/vietnam-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TaskNoticeSender } from './task-notice-sender.js';

@Injectable()
export class TaskDispatchService {
  private readonly logger = new Logger(TaskDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: TaskNoticeSender,
    private readonly clock: Clock,
  ) {}

  /**
   * Sends every waiting task, oldest first, to every free designer, at most once
   * per designer per day. Safe to run at any time: outside hours it does nothing.
   */
  async dispatch() {
    const now = this.clock.now();
    if (!isWorkingHours(now)) return;

    const [tasks, designers] = await Promise.all([
      this.prisma.task.findMany({ where: { status: 'WAITING' }, orderBy: { createdAt: 'asc' } }),
      this.prisma.designerProfile.findMany({
        where: { state: 'FREE' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const dayKey = vietnamDayKey(now);
    for (const task of tasks) {
      for (const designer of designers) {
        if (this.sender.canReach(designer)) await this.notify(task, designer, dayKey);
      }
    }
  }

  private async notify(
    task: { id: string; requirement: string },
    designer: { id: string; telegramChatId: string | null },
    dayKey: string,
  ) {
    // The unique row is the claim to send, so two dispatches cannot send the same message.
    const notice = await this.prisma.taskNotice
      .create({ data: { taskId: task.id, designerId: designer.id, dayKey } })
      .catch(() => null);
    if (!notice) return;

    try {
      const externalId = await this.sender.send(designer, task, notice.id);
      if (externalId) {
        await this.prisma.taskNotice.update({ where: { id: notice.id }, data: { externalId } });
      }
    } catch (error) {
      // Removing the row lets the next dispatch try this designer again.
      await this.prisma.taskNotice.delete({ where: { id: notice.id } });
      this.logger.warn(`Could not notify designer ${designer.id}: ${String(error)}`);
    }
  }
}
