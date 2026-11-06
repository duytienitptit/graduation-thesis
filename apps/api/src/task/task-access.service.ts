import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type TaskSide = 'CUSTOMER' | 'DESIGNER' | 'MANAGER';

/** Who may see a task: its customer, its designer and managers. Nobody else. */
@Injectable()
export class TaskAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async open(user: AuthUser, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { designer: true },
    });
    if (!task) throw new NotFoundException();

    const side: TaskSide | null =
      task.customerId === user.id
        ? 'CUSTOMER'
        : task.designer?.userId === user.id
          ? 'DESIGNER'
          : user.role === Role.MANAGER
            ? 'MANAGER'
            : null;
    if (!side) throw new ForbiddenException();
    return { task, side };
  }

  /** For actions only one of the task's two people may take. */
  async openAs(user: AuthUser, taskId: string, required: TaskSide) {
    const { task, side } = await this.open(user, taskId);
    if (side !== required) throw new ForbiddenException();
    return task;
  }
}
