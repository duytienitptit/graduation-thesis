import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { ChatService } from './chat.service.js';

class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsUUID()
  fileId?: string;
}

class SendSampleDto {
  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}

class AgreeDto {
  @IsUUID()
  versionId!: string;
}

class SendFinalDto {
  @IsUUID()
  fileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  backDescription?: string;

  @IsOptional()
  @IsUUID()
  backFileId?: string;
}

/** Messages go in by REST, where guards and checks already live, and out over Socket.IO. */
@Controller('tasks/:id')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('messages')
  list(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.list(user, id);
  }

  @Post('messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.chat.send(user, id, body);
  }

  @Roles(Role.DESIGNER)
  @Post('samples')
  sendSample(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendSampleDto,
  ) {
    return this.chat.sendSample(user, id, body.fileId, body.text);
  }

  @Roles(Role.CUSTOMER)
  @Post('agree')
  @HttpCode(204)
  agree(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AgreeDto,
  ) {
    return this.chat.agree(user, id, body.versionId);
  }

  @Roles(Role.DESIGNER)
  @Post('final')
  sendFinal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendFinalDto,
  ) {
    return this.chat.sendFinal(user, id, body);
  }
}
