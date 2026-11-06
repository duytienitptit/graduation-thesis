import { Logger } from '@nestjs/common';

export interface NoticeTask {
  id: string;
  requirement: string;
}

export interface NoticeDesigner {
  id: string;
  telegramChatId: string | null;
}

/** How designers hear about tasks: the fake sender in tests, Telegram otherwise. */
export abstract class TaskNoticeSender {
  /** False for a designer this sender has no way to contact. */
  abstract canReach(designer: NoticeDesigner): boolean;
  /** Sends or queues the notice. Returns the message id if it is already known. */
  abstract send(
    designer: NoticeDesigner,
    task: NoticeTask,
    noticeId: string,
  ): Promise<string | null>;
  /** Tells the designers who did not get the task. */
  abstract markTaken(task: NoticeTask, notices: { id: string }[]): Promise<void>;
  /** Tells the task's designer that the customer did something in the chat. */
  abstract messageWaiting(designer: NoticeDesigner, task: { id: string }): Promise<void>;
}

export class FakeTaskNoticeSender extends TaskNoticeSender {
  private readonly logger = new Logger('TaskNotice');

  canReach() {
    return true;
  }

  async send(designer: NoticeDesigner, task: NoticeTask) {
    this.logger.log(`Task ${task.id} sent to designer ${designer.id}`);
    return null;
  }

  async markTaken(task: NoticeTask, notices: unknown[]) {
    this.logger.log(`Task ${task.id} taken; ${notices.length} other notices to update`);
  }

  async messageWaiting(designer: NoticeDesigner, task: { id: string }) {
    this.logger.log(`Task ${task.id} has a new message for designer ${designer.id}`);
  }
}
