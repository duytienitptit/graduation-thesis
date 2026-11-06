import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { createS3Client } from '../integrations/files/s3.client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CHECK_TIMEOUT_MS = 2000;

export interface ServiceHealth {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  services: { postgres: ServiceHealth; redis: ServiceHealth; storage: ServiceHealth };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis, storage] = await Promise.all([
      this.measure(() => this.pingPostgres()),
      this.measure(() => this.pingRedis()),
      this.measure(() => this.pingStorage()),
    ]);
    const healthy = postgres.ok && redis.ok && storage.ok;
    return { status: healthy ? 'ok' : 'error', services: { postgres, redis, storage } };
  }

  private async measure(ping: () => Promise<unknown>): Promise<ServiceHealth> {
    const startedAt = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([ping(), timeout]);
      return { ok: true, ms: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, ms: Date.now() - startedAt, error: message || 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingPostgres() {
    await this.prisma.$queryRaw`select 1`;
  }

  private async pingRedis() {
    const client = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined); // The failed connect() below reports it.
    try {
      await client.connect();
      await client.ping();
    } finally {
      client.disconnect();
    }
  }

  private async pingStorage() {
    const client = createS3Client(this.config, 1);
    try {
      await client.send(new ListBucketsCommand({}));
    } finally {
      client.destroy();
    }
  }
}
