import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DesignersService } from './designers.service.js';

describe('designers', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const login = async (email: string) =>
    (await request(app.getHttpServer()).post('/auth/dev-login').send({ email }).expect(200)).body
      .token as string;

  async function designer(state: 'FREE' | 'BUSY' | 'PAUSED') {
    const user = await prisma.user.create({
      data: {
        email: `${crypto.randomUUID()}@designers.test`,
        name: 'Test',
        role: 'DESIGNER',
        designer: { create: { state } },
      },
      include: { designer: true },
    });
    userIds.push(user.id);
    return user.designer!;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.designerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('shows a designer their own state, and starts them as free', async () => {
    const token = await login('designer2@example.test');
    const res = await request(app.getHttpServer())
      .get('/designers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toMatchObject({ state: 'FREE', telegramLinked: false });
    expect(res.body).not.toHaveProperty('telegramChatId');
  });

  it('is for designers only', async () => {
    const token = await login('khach@example.test');
    await request(app.getHttpServer())
      .get('/designers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer()).get('/designers/me').expect(401);
  });

  it('lists only free designers', async () => {
    const free = await designer('FREE');
    const busy = await designer('BUSY');
    const paused = await designer('PAUSED');
    const ids = (await app.get(DesignersService).listFree()).map((profile) => profile.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(busy.id);
    expect(ids).not.toContain(paused.id);
  });
});
