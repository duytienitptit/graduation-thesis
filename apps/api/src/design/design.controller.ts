import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { IsInt, IsObject, IsString, Min } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { CatalogPort } from '../integrations/catalog/catalog.port.js';
import { DesignSessionService } from './design-session.service.js';
import { QUESTION_SETS } from './question-sets.js';

class CreateSessionDto {
  @IsString()
  productId!: string;

  @IsString()
  colourId!: string;

  @IsString()
  materialId!: string;

  @IsString()
  size!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

class SaveAnswersDto {
  @IsObject()
  answers!: Record<string, unknown>;
}

@Controller('design')
export class DesignController {
  constructor(
    private readonly catalog: CatalogPort,
    private readonly sessions: DesignSessionService,
  ) {}

  @Get('products/:productId/questions')
  async questions(@Param('productId') productId: string) {
    const product = await this.catalog.getProduct(productId);
    if (!product) throw new NotFoundException();
    return QUESTION_SETS[product.shirtType];
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions')
  createSession(@CurrentUser() user: AuthUser, @Body() body: CreateSessionDto) {
    return this.sessions.create(user, body);
  }

  @Roles(Role.CUSTOMER)
  @Get('sessions')
  listSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.listOwn(user);
  }

  @Get('sessions/:id')
  getSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.get(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Put('sessions/:id/answers')
  saveAnswers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveAnswersDto,
  ) {
    return this.sessions.saveAnswers(user, id, body.answers);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/answers/submit')
  @HttpCode(200)
  submitAnswers(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.submitAnswers(user, id);
  }
}
