import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InlineKeyboard } from 'grammy';
import { Answers } from '../design/answers.js';
import { SpecSnapshot } from '../design/design-session.service.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MARK_TAKEN_JOB,
  NOTICE_JOB_ATTEMPTS,
  NOTICE_QUEUE,
} from '../task/queued-telegram-sender.js';
import { taskSummary } from './task-summary.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { CLAIM_PREFIX, MESSAGES } from './telegram-handlers.js';

@Processor(NOTICE_QUEUE)
export class TelegramNoticeProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramNoticeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bot: TelegramBotService,
    private readonly files: FilesPort,
  ) {
    super();
  }

  async process(job: Job<{ noticeId: string }>) {
    return job.name === MARK_TAKEN_JOB ? this.markTaken(job) : this.send(job);
  }

  private async markTaken(job: Job<{ noticeId: string }>) {
    const notice = await this.prisma.taskNotice.findUnique({
      where: { id: job.data.noticeId },
      include: { designer: true },
    });
    // No message id: it was never sent, and the send job now skips it.
    if (!notice?.externalId || !notice.designer.telegramChatId) return;

    await this.bot.replaceNotice(
      notice.designer.telegramChatId,
      Number(notice.externalId),
      MESSAGES.takenNotice,
    );
  }

  private async send(job: Job<{ noticeId: string }>) {
    const notice = await this.prisma.taskNotice.findUnique({
      where: { id: job.data.noticeId },
      include: {
        task: { include: { session: true, referenceVersion: true } },
        designer: true,
      },
    });
    if (!notice || notice.externalId) return;

    // Taken while this waited in the queue: there is nothing left to offer.
    if (notice.task.status !== 'WAITING' || !notice.designer.telegramChatId) {
      await this.prisma.taskNotice.delete({ where: { id: notice.id } });
      return;
    }

    const { session, referenceVersion, requirement } = notice.task;
    const caption = taskSummary(
      session.specSnapshot as unknown as SpecSnapshot,
      session.answers as unknown as Answers,
      requirement,
    );

    try {
      const image = await this.files.readImage(referenceVersion.fileId);
      const message = await this.bot.sendPhoto(notice.designer.telegramChatId, image.data, {
        caption,
        reply_markup: new InlineKeyboard().text('Nhận task', `${CLAIM_PREFIX}${notice.taskId}`),
      });
      await this.prisma.taskNotice.update({
        where: { id: notice.id },
        data: { externalId: String(message.message_id) },
      });
    } catch (error) {
      if (job.attemptsMade + 1 >= NOTICE_JOB_ATTEMPTS) {
        // Removing the row lets the next dispatch try this designer again.
        await this.prisma.taskNotice.delete({ where: { id: notice.id } });
        this.logger.warn(`Gave up on notice ${notice.id}: ${String(error)}`);
      }
      throw error;
    }
  }
}
