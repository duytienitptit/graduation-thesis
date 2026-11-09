import { Queue } from 'bullmq';
import {
  NoticeDesigner,
  NoticeEndReason,
  NoticeTask,
  TaskNoticeSender,
} from './task-notice-sender.js';

export const NOTICE_QUEUE = 'telegram-notices';
export const NOTICE_JOB_ATTEMPTS = 5;
export const SEND_JOB = 'send';
export const MARK_TAKEN_JOB = 'mark-taken';
export const CHAT_NOTICE_JOB = 'chat-notice';

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

  async markTaken(
    _task: NoticeTask,
    notices: { id: string }[],
    reason: NoticeEndReason = 'taken',
  ) {
    await this.queue.addBulk(
      notices.map(({ id }) => ({
        name: MARK_TAKEN_JOB,
        data: { noticeId: id, reason },
        opts: JOB_OPTIONS,
      })),
    );
  }

  async messageWaiting(designer: NoticeDesigner, task: { id: string }) {
    if (!this.canReach(designer)) return;
    await this.queue.add(CHAT_NOTICE_JOB, { taskId: task.id }, JOB_OPTIONS);
  }
}
