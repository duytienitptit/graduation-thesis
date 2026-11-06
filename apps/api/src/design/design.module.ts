import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { CatalogModule } from '../integrations/catalog/catalog.module.js';
import { FilesModule } from '../integrations/files/files.module.js';
import { TaskModule } from '../task/task.module.js';
import { DesignImagesService } from './design-images.service.js';
import { DesignViewsService } from './design-views.service.js';
import { DesignSessionService } from './design-session.service.js';
import { DesignController } from './design.controller.js';

@Module({
  imports: [AiModule, CatalogModule, FilesModule, TaskModule],
  controllers: [DesignController],
  providers: [DesignImagesService, DesignSessionService, DesignViewsService],
})
export class DesignModule {}
