import { describe, expect, it, afterEach } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { HealthReport, HealthService } from './health.service.js';

describe('GET /health', () => {
  let app: INestApplication;

  afterEach(() => app.close());

  async function start(fake?: Partial<HealthService>) {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    if (fake) builder.overrideProvider(HealthService).useValue(fake);
    app = (await builder.compile()).createNestApplication();
    await app.init();
  }

  it('returns 200 when the real PostgreSQL, Redis and storage answer', async () => {
    await start();
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.postgres.ok).toBe(true);
    expect(res.body.services.redis.ok).toBe(true);
    expect(res.body.services.storage.ok).toBe(true);
  });

  it('returns 503 and names the failed service when one is down', async () => {
    const report: HealthReport = {
      status: 'error',
      services: {
        postgres: { ok: true, ms: 1 },
        redis: { ok: false, ms: 1, error: 'unreachable' },
        storage: { ok: true, ms: 1 },
      },
    };
    await start({ check: async () => report });
    const res = await request(app.getHttpServer()).get('/health').expect(503);
    expect(res.body.services.redis.ok).toBe(false);
  });
});
