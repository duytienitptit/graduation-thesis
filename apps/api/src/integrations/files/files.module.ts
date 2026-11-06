import { Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { FilesPort } from './files.port.js';
import { MinioFilesService } from './minio-files.service.js';

@Module({
  controllers: [FilesController],
  providers: [{ provide: FilesPort, useClass: MinioFilesService }],
  exports: [FilesPort],
})
export class FilesModule {}
