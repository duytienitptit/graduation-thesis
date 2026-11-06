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
import { IsInt, IsObject, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';
import { CurrentUser, Roles } from '../integrations/auth/auth.decorators.js';
import { AuthUser } from '../integrations/auth/auth.port.js';
import { CatalogPort } from '../integrations/catalog/catalog.port.js';
import { DesignImagesService } from './design-images.service.js';
import { DesignSessionService } from './design-session.service.js';
import { DesignViewsService } from './design-views.service.js';
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

class EditImageDto {
  @IsUUID()
  versionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  request!: string;
}

class ChooseMainDto {
  @IsUUID()
  versionId!: string;
}

class AddExtraViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;
}

@Controller('design')
export class DesignController {
  constructor(
    private readonly catalog: CatalogPort,
    private readonly sessions: DesignSessionService,
    private readonly images: DesignImagesService,
    private readonly views: DesignViewsService,
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

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/images')
  createImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.images.createFirst(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/edits')
  editImage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EditImageDto,
  ) {
    return this.images.edit(user, id, body.versionId, body.request);
  }

  @Get('sessions/:id/workspace')
  workspace(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.images.workspace(user, id);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/main-image')
  chooseMain(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChooseMainDto,
  ) {
    return this.views.chooseMain(user, id, body.versionId);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/views/:viewId/generate')
  generateView(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ) {
    return this.views.generate(user, id, viewId);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/views/:viewId/regenerate')
  regenerateView(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ) {
    return this.views.regenerate(user, id, viewId);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/views/:viewId/approve')
  @HttpCode(200)
  approveView(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
  ) {
    return this.views.approve(user, id, viewId);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/views')
  addExtraView(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddExtraViewDto,
  ) {
    return this.views.addExtra(user, id, body.description);
  }

  @Roles(Role.CUSTOMER)
  @Post('sessions/:id/lock')
  lock(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.lock(user, id);
  }

  @Get('locked-products/:id')
  lockedProduct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.getLocked(user, id);
  }
}
