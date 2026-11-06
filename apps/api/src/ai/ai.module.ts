import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesModule } from '../integrations/files/files.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { FakeImageProvider } from './fake-image.provider.js';
import { IMAGE_QUEUE, ImageJobsService } from './image-jobs.service.js';
import { ImageProvider } from './image-provider.js';
import { ImageProcessor } from './image.processor.js';
import { NanoBananaProvider } from './nano-banana.provider.js';

export function createImageProvider(config: ConfigService): ImageProvider {
  const provider = config.get<string>('IMAGE_PROVIDER') ?? 'fake';
  if (provider === 'fake') return new FakeImageProvider();
  if (provider === 'nano-banana') {
    return new NanoBananaProvider(config.getOrThrow<string>('GEMINI_API_KEY'));
  }
  throw new Error(`Unknown IMAGE_PROVIDER: ${provider}`);
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: { host: url.hostname, port: Number(url.port || 6379) },
          // Tests use their own prefix so a running dev worker never takes their jobs.
          prefix: config.get<string>('QUEUE_PREFIX') ?? 'bull',
        };
      },
    }),
    BullModule.registerQueue({ name: IMAGE_QUEUE }),
    FilesModule,
    RealtimeModule,
  ],
  providers: [
    { provide: ImageProvider, inject: [ConfigService], useFactory: createImageProvider },
    ImageJobsService,
    ImageProcessor,
  ],
  exports: [ImageJobsService],
})
export class AiModule {}
