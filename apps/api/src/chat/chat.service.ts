import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { ALLOWED_MIME_TYPES, FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { TaskAccessService } from '../task/task-access.service.js';
import { TaskNoticeSender } from '../task/task-notice-sender.js';
import { TasksService } from '../task/tasks.service.js';

export const MESSAGE_EVENT = 'task.message';
export const CHAT_NOTICE_GAP_MS = 10 * 60 * 1000;

const MESSAGE_INCLUDE = {
  sender: { select: { name: true, role: true } },
  version: { select: { fileId: true } },
  file: { select: { id: true, mimeType: true } },
} as const;

type ChatTask = Awaited<ReturnType<TaskAccessService['open']>>['task'];

export interface FinalInput {
  fileId: string;
  backDescription?: string;
  backFileId?: string;
}

/** The working part of a task: messages, samples, "Agree" and the final. */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly files: FilesPort,
    private readonly realtime: RealtimeGateway,
    private readonly sender: TaskNoticeSender,
    private readonly tasks: TasksService,
    private readonly clock: Clock,
  ) {}

  async list(user: AuthUser, taskId: string) {
    await this.access.open(user, taskId);
    const messages = await this.prisma.taskMessage.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: MESSAGE_INCLUDE,
    });
    return Promise.all(messages.map((message) => this.present(message)));
  }

  async send(user: AuthUser, taskId: string, input: { text?: string; fileId?: string }) {
    const { task, side } = await this.access.open(user, taskId);
    if (side === 'MANAGER') throw new ForbiddenException();
    this.assertOpen(task);

    const text = input.text?.trim() || null;
    if (!text && !input.fileId) throw new BadRequestException('Message is empty');
    if (input.fileId) await this.assertOwned(user, [input.fileId], ALLOWED_MIME_TYPES);

    const message = await this.prisma.taskMessage.create({
      data: {
        taskId,
        senderId: user.id,
        kind: input.fileId ? 'FILE' : 'TEXT',
        text,
        fileId: input.fileId,
        createdAt: this.clock.now(),
      },
      include: MESSAGE_INCLUDE,
    });

    const presented = await this.publish(task, message);
    if (side === 'CUSTOMER') await this.tellDesigner(task);
    return presented;
  }

  /** A new sample asks for a new decision, so it cancels "Agree" and any final built on it. */
  async sendSample(user: AuthUser, taskId: string, fileId: string, text?: string) {
    const task = await this.access.openAs(user, taskId, 'DESIGNER');
    await this.assertOwned(user, [fileId]);

    const message = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.task.updateMany({
        where: { id: taskId, status: 'ASSIGNED' },
        data: {
          agreedVersionId: null,
          agreedAt: null,
          finalVersionId: null,
          backDescription: null,
          backFileId: null,
        },
      });
      if (!count) throw new ConflictException('This task has ended');

      const version = await tx.designVersion.create({
        data: {
          sessionId: task.sessionId,
          parentVersionId: task.referenceVersionId,
          fileId,
          source: 'DESIGNER',
          createdAt: this.clock.now(),
        },
      });
      return tx.taskMessage.create({
        data: {
          taskId,
          senderId: user.id,
          kind: 'SAMPLE',
          text: text?.trim() || null,
          versionId: version.id,
          createdAt: this.clock.now(),
        },
        include: MESSAGE_INCLUDE,
      });
    });

    const presented = await this.publish(task, message);
    this.tasks.announce(task);
    return presented;
  }

  /** Works on any sample of this task. Agreeing to another sample drops the final made for the old one. */
  async agree(user: AuthUser, taskId: string, versionId: string) {
    const task = await this.access.openAs(user, taskId, 'CUSTOMER');
    this.assertOpen(task);

    const sample = await this.prisma.taskMessage.findFirst({
      where: { taskId, kind: 'SAMPLE', versionId },
    });
    if (!sample) throw new NotFoundException('Sample not found');
    if (task.agreedVersionId === versionId) return;

    const { count } = await this.prisma.task.updateMany({
      where: { id: taskId, status: 'ASSIGNED' },
      data: {
        agreedVersionId: versionId,
        agreedAt: this.clock.now(),
        finalVersionId: null,
        backDescription: null,
        backFileId: null,
      },
    });
    if (!count) throw new ConflictException('This task has ended');

    this.tasks.announce(task);
    await this.tellDesigner(task);
  }

  /** Can be sent again until "Done"; the newest counts. */
  async sendFinal(user: AuthUser, taskId: string, input: FinalInput) {
    const task = await this.access.openAs(user, taskId, 'DESIGNER');
    const backDescription = input.backDescription?.trim() || null;
    const backFileId = input.backFileId ?? null;
    if (!backDescription && !backFileId) {
      throw new BadRequestException({ code: 'back-required' });
    }
    await this.assertOwned(user, [input.fileId, ...(backFileId ? [backFileId] : [])]);

    const message = await this.prisma.$transaction(async (tx) => {
      const version = await tx.designVersion.create({
        data: {
          sessionId: task.sessionId,
          parentVersionId: task.agreedVersionId,
          fileId: input.fileId,
          source: 'DESIGNER',
          createdAt: this.clock.now(),
        },
      });
      const { count } = await tx.task.updateMany({
        where: { id: taskId, status: 'ASSIGNED', agreedVersionId: { not: null } },
        data: { finalVersionId: version.id, backDescription, backFileId },
      });
      if (!count) throw new ConflictException({ code: 'not-agreed' });

      return tx.taskMessage.create({
        data: {
          taskId,
          senderId: user.id,
          kind: 'FINAL',
          text: backDescription,
          fileId: backFileId,
          versionId: version.id,
          createdAt: this.clock.now(),
        },
        include: MESSAGE_INCLUDE,
      });
    });

    const presented = await this.publish(task, message);
    this.tasks.announce(task);
    return presented;
  }

  private assertOpen(task: ChatTask) {
    if (task.status !== 'ASSIGNED') throw new ConflictException('This task is not open');
  }

  private async assertOwned(user: AuthUser, fileIds: string[], types?: readonly string[]) {
    if (!(await this.files.ownsReadyFiles(user, fileIds, types))) {
      throw new BadRequestException('File not found');
    }
  }

  private async present(message: PresentableMessage) {
    const link = async (fileId: string) => (await this.files.getLink(fileId)).url;
    return {
      id: message.id,
      taskId: message.taskId,
      senderId: message.senderId,
      senderName: message.sender.name,
      senderRole: message.sender.role,
      kind: message.kind,
      text: message.text,
      versionId: message.versionId,
      createdAt: message.createdAt,
      imageUrl: message.version ? await link(message.version.fileId) : null,
      attachment: message.file
        ? { url: await link(message.file.id), mimeType: message.file.mimeType }
        : null,
    };
  }

  private async publish(task: ChatTask, message: PresentableMessage) {
    const presented = await this.present(message);
    this.realtime.emitToUser(task.customerId, MESSAGE_EVENT, presented);
    if (task.designer) this.realtime.emitToUser(task.designer.userId, MESSAGE_EVENT, presented);
    return presented;
  }

  /** The update is the claim to send, so two quick messages cannot both notify. */
  private async tellDesigner(task: ChatTask) {
    if (!task.designer) return;

    const now = this.clock.now();
    const { count } = await this.prisma.task.updateMany({
      where: {
        id: task.id,
        OR: [
          { lastChatNoticeAt: null },
          { lastChatNoticeAt: { lte: new Date(now.getTime() - CHAT_NOTICE_GAP_MS) } },
        ],
      },
      data: { lastChatNoticeAt: now },
    });
    if (!count) return;

    // The message is already stored, so a Telegram problem must not fail the request.
    await this.sender
      .messageWaiting(task.designer, task)
      .catch((error: unknown) => this.logger.warn(`Chat notice failed: ${String(error)}`));
  }
}

interface PresentableMessage {
  id: string;
  taskId: string;
  senderId: string;
  kind: string;
  text: string | null;
  versionId: string | null;
  createdAt: Date;
  sender: { name: string; role: string };
  version: { fileId: string } | null;
  file: { id: string; mimeType: string } | null;
}
