import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/** Gateway decorators run before .env loads, so CORS is set here instead. */
export class RealtimeAdapter extends IoAdapter {
  private readonly origin: string;

  constructor(app: INestApplication) {
    super(app);
    this.origin = app.get(ConfigService).getOrThrow<string>('WEB_ORIGIN');
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: this.origin } } as ServerOptions);
  }
}
