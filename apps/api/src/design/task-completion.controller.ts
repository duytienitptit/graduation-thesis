import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { DesignViewsService } from './design-views.service.js';

/** Here, not in the task module, because "Done" starts the views step. */
@Controller('tasks/:id')
export class TaskCompletionController {
  constructor(private readonly views: DesignViewsService) {}

  @Roles(Role.DESIGNER)
  @Post('done')
  @HttpCode(204)
  done(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.finishTask(user, id);
  }
}
