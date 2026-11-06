import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogPort } from './catalog.port.js';
import { StaticCatalogService } from './static-catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [{ provide: CatalogPort, useClass: StaticCatalogService }],
  exports: [CatalogPort],
})
export class CatalogModule {}
