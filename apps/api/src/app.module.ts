import { resolve } from 'node:path';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { AiModule } from './ai/ai.module.js';
import { ClockModule } from './common/clock.js';
import { DesignModule } from './design/design.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './integrations/auth/auth.module.js';
import { CatalogModule } from './integrations/catalog/catalog.module.js';
import { FilesModule } from './integrations/files/files.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TaskModule } from './task/task.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    // One .env at the repo root; pnpm runs this app from apps/api.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(process.cwd(), '../../.env') }),
    PrismaModule,
    ClockModule,
    AiModule,
    AuthModule,
    CatalogModule,
    FilesModule,
    RealtimeModule,
    TaskModule,
    TelegramModule,
    DesignModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
  ],
})
export class AppModule {}
