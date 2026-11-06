import { Module } from '@nestjs/common';
import { CatalogModule } from '../integrations/catalog/catalog.module.js';
import { FilesModule } from '../integrations/files/files.module.js';
import { DesignSessionService } from './design-session.service.js';
import { DesignController } from './design.controller.js';

@Module({
  imports: [CatalogModule, FilesModule],
  controllers: [DesignController],
  providers: [DesignSessionService],
})
export class DesignModule {}
