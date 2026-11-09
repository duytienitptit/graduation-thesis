import { Injectable } from '@nestjs/common';
import { answerList, Answers, uploadedFileIds } from '../design/answers.js';
import type { SpecSnapshot } from '../design/design-session.service.js';
import { QUESTION_SETS } from '../design/question-sets.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { viewLabel } from '../telegram/task-summary.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DesignersService } from './designers.service.js';
import { TaskAccessService } from './task-access.service.js';

/** What the designer area and the chat show about a task. */
@Injectable()
export class TaskDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly designers: DesignersService,
    private readonly access: TaskAccessService,
    private readonly files: FilesPort,
  ) {}

  async listForDesigner(user: AuthUser) {
    const designer = await this.designers.getByUser(user.id);
    const tasks = await this.prisma.task.findMany({
      where: { designerId: designer.id },
      orderBy: { assignedAt: 'desc' },
      include: { session: true, customer: { select: { name: true } }, targetView: true },
    });

    const rows = tasks.map((task) => ({
      id: task.id,
      status: task.status,
      requirement: task.requirement,
      productName: (task.session.specSnapshot as unknown as SpecSnapshot).product.name,
      customerName: task.customer.name,
      assignedAt: task.assignedAt,
      doneAt: task.doneAt,
      closedAt: task.closedAt,
      viewLabel: task.targetView ? viewLabel(task.targetView) : null,
    }));
    return {
      current: rows.find((row) => row.status === 'ASSIGNED') ?? null,
      past: rows.filter((row) => row.status === 'DONE' || row.status === 'CLOSED'),
    };
  }

  async detail(user: AuthUser, taskId: string) {
    const { side } = await this.access.open(user, taskId);
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        session: true,
        customer: { select: { name: true } },
        designer: { include: { user: { select: { name: true } } } },
        referenceVersion: { select: { fileId: true } },
        finalVersion: { select: { fileId: true } },
        targetView: true,
      },
    });

    const specs = task.session.specSnapshot as unknown as SpecSnapshot;
    const answers = task.session.answers as unknown as Answers;
    const set = QUESTION_SETS[specs.product.shirtType];
    const link = async (fileId: string) => (await this.files.getLink(fileId)).url;

    return {
      id: task.id,
      side,
      status: task.status,
      sessionId: task.sessionId,
      requirement: task.requirement,
      customerName: task.customer.name,
      designerName: task.designer?.user.name ?? null,
      assignedAt: task.assignedAt,
      doneAt: task.doneAt,
      closedAt: task.closedAt,
      cancelledAt: task.cancelledAt,
      closeReason: task.closeReason,
      silenceAlertAt: task.silenceAlertAt,
      targetView: task.targetView
        ? { type: task.targetView.type, label: viewLabel(task.targetView) }
        : null,
      product: {
        name: specs.product.name,
        colour: specs.colour.name,
        material: specs.material.name,
        size: specs.size,
        quantity: specs.quantity,
      },
      referenceImageUrl: await link(task.referenceVersion.fileId),
      answers: answerList(set, answers),
      uploads: await Promise.all(uploadedFileIds(set, answers).map(link)),
      agreedVersionId: task.agreedVersionId,
      agreedAt: task.agreedAt,
      finalVersionId: task.finalVersionId,
      finalImageUrl: task.finalVersion ? await link(task.finalVersion.fileId) : null,
      backDescription: task.backDescription,
      backImageUrl: task.backFileId ? await link(task.backFileId) : null,
    };
  }
}
