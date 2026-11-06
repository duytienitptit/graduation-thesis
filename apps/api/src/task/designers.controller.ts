import { Controller, Get } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { DesignersService } from './designers.service.js';
import { TaskDetailsService } from './task-details.service.js';

@Controller('designers')
export class DesignersController {
  constructor(
    private readonly designers: DesignersService,
    private readonly details: TaskDetailsService,
  ) {}

  @Roles(Role.DESIGNER)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.designers.summary(user.id);
  }

  @Roles(Role.DESIGNER)
  @Get('me/tasks')
  tasks(@CurrentUser() user: AuthUser) {
    return this.details.listForDesigner(user);
  }
}
