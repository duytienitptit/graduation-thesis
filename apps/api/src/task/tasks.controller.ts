import {
  Body,
  Controller,
  ConflictException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { DevOnlyGuard } from '../integrations/auth/dev-auth.controller.js';
import { DesignersService } from './designers.service.js';
import { TaskDetailsService } from './task-details.service.js';
import { TasksService } from './tasks.service.js';

class CreateTaskDto {
  @IsUUID()
  versionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  requirement!: string;
}

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly designers: DesignersService,
    private readonly details: TaskDetailsService,
  ) {}

  @Get('tasks/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.details.detail(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Post('design/sessions/:id/tasks')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateTaskDto,
  ) {
    return this.tasks.create(user, id, body.versionId, body.requirement);
  }

  /** Stands in for the Telegram button in browser tests, so it never runs in production. */
  @Roles(Role.DESIGNER)
  @UseGuards(DevOnlyGuard)
  @Post('tasks/:id/dev-claim')
  @HttpCode(200)
  async devClaim(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const designer = await this.designers.getByUser(user.id);
    const result = await this.tasks.claim(designer.id, id);
    if (!result.ok) throw new ConflictException({ code: result.reason });
    return result;
  }
}
