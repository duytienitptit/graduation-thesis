import { Queue } from 'bullmq';
import { NoticeDesigner, NoticeTask, TaskNoticeSender } from './task-notice-sender.js';

export const NOTICE_QUEUE = 'telegram-notices';
export const NOTICE_JOB_ATTEMPTS = 5;
export const SEND_JOB = 'send';
export const MARK_TAKEN_JOB = 'mark-taken';

const JOB_OPTIONS = {
  attempts: NOTICE_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: true,
};

/** Puts Telegram work on a queue, so a slow or failing Telegram never blocks a request. */
export class QueuedTelegramSender extends TaskNoticeSender {
  constructor(private readonly queue: Queue) {
    super();
  }

  canReach(designer: NoticeDesigner) {
    return designer.telegramChatId !== null;
  }

  async send(_designer: NoticeDesigner, _task: NoticeTask, noticeId: string) {
    await this.queue.add(SEND_JOB, { noticeId }, JOB_OPTIONS);
    return null;
  }

  async markTaken(_task: NoticeTask, notices: { id: string }[]) {
    await this.queue.addBulk(
      notices.map(({ id }) => ({
        name: MARK_TAKEN_JOB,
        data: { noticeId: id },
        opts: JOB_OPTIONS,
      })),
    );
  }
}
