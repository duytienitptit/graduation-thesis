import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { Role } from '../../generated/prisma/enums.js';
import { Roles } from './auth.decorators.js';

@Controller('probe')
class ProbeController {
  @Roles(Role.MANAGER)
  @Get('manager-only')
  managerOnly() {
    return { ok: true };
  }
}

describe('dev login', () => {
  let app: INestApplication;

  const server = () => app.getHttpServer();
  const tokenFor = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body.token;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('lists the seeded accounts without login', async () => {
    const res = await request(server()).get('/auth/dev-users').expect(200);
    expect(res.body.map((user: { role: string }) => user.role)).toEqual(
      expect.arrayContaining(['CUSTOMER', 'DESIGNER', 'MANAGER']),
    );
  });

  it('logs in a seeded user and returns them from /auth/me', async () => {
    const token = await tokenFor('khach@example.test');
    const res = await request(server())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ email: 'khach@example.test', role: 'CUSTOMER' });
  });

  it('rejects an unknown email and a malformed one', async () => {
    await request(server())
      .post('/auth/dev-login')
      .send({ email: 'nobody@example.test' })
      .expect(401);
    await request(server()).post('/auth/dev-login').send({ email: 'not-an-email' }).expect(400);
  });

  it('requires a valid token by default', async () => {
    await request(server()).get('/auth/me').expect(401);
    await request(server()).get('/auth/me').set('Authorization', 'Bearer nonsense').expect(401);
  });

  it('keeps /health public', async () => {
    await request(server()).get('/health').expect(200);
  });

  it('enforces roles', async () => {
    const customer = await tokenFor('khach@example.test');
    const manager = await tokenFor('quanli@example.test');
    await request(server())
      .get('/probe/manager-only')
      .set('Authorization', `Bearer ${customer}`)
      .expect(403);
    await request(server())
      .get('/probe/manager-only')
      .set('Authorization', `Bearer ${manager}`)
      .expect(200);
  });

  it('turns dev login off in production', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await request(server()).get('/auth/dev-users').expect(404);
      await request(server())
        .post('/auth/dev-login')
        .send({ email: 'khach@example.test' })
        .expect(404);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
