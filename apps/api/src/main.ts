import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { RealtimeAdapter } from './realtime/realtime.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Stops the bot and workers cleanly, so a restart does not fight the old process.
  app.enableShutdownHooks();

  app.enableCors({ origin: config.getOrThrow<string>('WEB_ORIGIN') });
  app.useWebSocketAdapter(new RealtimeAdapter(app));

  await app.listen(config.get<number>('API_PORT') ?? 4000);
}

void bootstrap();
