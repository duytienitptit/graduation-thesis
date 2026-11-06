import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeAdapter } from '../realtime/realtime.adapter.js';
import { DailyDispatchProcessor, DISPATCH_QUEUE } from './daily-dispatch.js';
import { TaskDispatchService } from './task-dispatch.service.js';
import { NoticeDesigner, NoticeTask, TaskNoticeSender } from './task-notice-sender.js';
import { TASK_EVENT, TasksService } from './tasks.service.js';

class RecordingSender extends TaskNoticeSender {
  sent: { taskId: string; designerId: string }[] = [];
  taken: { taskId: string; count: number }[] = [];
  failFor = new Set<string>();
  /** Only this file's designers, so development designers get no fake notices. */
  reachable = new Set<string>();

  canReach(designer: NoticeDesigner) {
    return this.reachable.has(designer.id);
  }

  async send(designer: NoticeDesigner, task: NoticeTask) {
    if (this.failFor.has(designer.id)) throw new Error('Telegram down');
    this.sent.push({ taskId: task.id, designerId: designer.id });
    return `message-${this.sent.length}`;
  }

  async markTaken(task: NoticeTask, notices: { id: string }[]) {
    this.taken.push({ taskId: task.id, count: notices.length });
  }

  async messageWaiting() {}
}

// 10:00, 18:00 and 08:00 in Vietnam.
const IN_HOURS = new Date('2026-11-09T03:00:00Z');
const EVENING = new Date('2026-11-09T11:00:00Z');
const NEXT_MORNING_EARLY = new Date('2026-11-10T01:00:00Z');
const NEXT_MORNING_NINE = new Date('2026-11-10T02:00:00Z');

describe('tasks and dispatch', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TasksService;
  let dispatcher: TaskDispatchService;
  let url: string;
  const sender = new RecordingSender();
  let now = IN_HOURS;
  const userIds: string[] = [];
  const taskIds = new Set<string>();

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;

  async function login(email: string) {
    const res = await request(server()).post('/auth/dev-login').send({ email }).expect(200);
    return res.body.token as string;
  }

  async function newCustomer() {
    const email = `${crypto.randomUUID()}@tasks.test`;
    const user = await prisma.user.create({ data: { email, name: 'Khách', role: 'CUSTOMER' } });
    userIds.push(user.id);
    return { id: user.id, token: await login(email) };
  }

  async function newDesigner(state: 'FREE' | 'BUSY' | 'PAUSED' = 'FREE') {
    const email = `${crypto.randomUUID()}@tasks.test`;
    const user = await prisma.user.create({
      data: { email, name: 'Designer', role: 'DESIGNER', designer: { create: { state } } },
      include: { designer: true },
    });
    userIds.push(user.id);
    sender.reachable.add(user.designer!.id);
    return { ...user.designer!, email };
  }

  /** A session with one AI image, built directly so these tests stay on tasks. */
  async function sessionWithImage(owner: { id: string }, status: 'ANSWERED' | 'VIEWS' = 'ANSWERED') {
    const session = await prisma.designSession.create({
      data: { customerId: owner.id, specSnapshot: {}, status },
    });
    const file = await prisma.fileObject.create({
      data: {
        ownerId: owner.id,
        storageKey: `test/${crypto.randomUUID()}.png`,
        mimeType: 'image/png',
        size: 1,
        purpose: 'AI_IMAGE',
        status: 'READY',
      },
    });
    const version = await prisma.designVersion.create({
      data: { sessionId: session.id, fileId: file.id, source: 'AI' },
    });
    return { id: session.id, versionId: version.id };
  }

  const post = (sessionId: string, owner: { token: string }, body: object) =>
    request(server())
      .post(`/design/sessions/${sessionId}/tasks`)
      .set(...bearer(owner.token))
      .send(body);

  async function newTask(owner?: { id: string; token: string }) {
    const customer = owner ?? (await newCustomer());
    const session = await sessionWithImage(customer);
    const res = await post(session.id, customer, {
      versionId: session.versionId,
      requirement: 'Làm logo đẹp hơn',
    }).expect(201);
    taskIds.add(res.body.id);
    return { customer, session, task: res.body as { id: string; status: string } };
  }

  // Development data may hold real waiting tasks, so only this file's tasks are compared.
  const sentTo = (designerId: string) =>
    sender.sent.filter(
      (notice) => notice.designerId === designerId && taskIds.has(notice.taskId),
    );

  /** Keeps other tests' free designers out of the way. */
  async function pauseEveryone() {
    await prisma.designerProfile.updateMany({
      where: { user: { email: { endsWith: '@tasks.test' } } },
      data: { state: 'PAUSED' },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TaskNoticeSender)
      .useValue(sender)
      .overrideProvider(Clock)
      .useValue({ now: () => now })
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(server().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tasks = app.get(TasksService);
    dispatcher = app.get(TaskDispatchService);
  });

  afterEach(async () => {
    now = IN_HOURS;
    sender.sent = [];
    sender.taken = [];
    sender.failFor.clear();
    await pauseEveryone();
    await prisma.task.updateMany({
      where: { customer: { email: { endsWith: '@tasks.test' } }, status: 'WAITING' },
      data: { status: 'ASSIGNED' },
    });
  });

  afterAll(async () => {
    const customer = { customerId: { in: userIds } };
    await prisma.taskNotice.deleteMany({
      where: { OR: [{ task: customer }, { designer: { userId: { in: userIds } } }] },
    });
    await prisma.task.deleteMany({ where: customer });
    await prisma.designVersion.deleteMany({ where: { session: customer } });
    await prisma.designSession.deleteMany({ where: customer });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.designerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  describe('creating a task', () => {
    it('needs an AI image, and stores the requirement with the image', async () => {
      const { session, task } = await newTask();
      expect(task.status).toBe('WAITING');
      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(stored).toMatchObject({
        requirement: 'Làm logo đẹp hơn',
        referenceVersionId: session.versionId,
      });
    });

    it('refuses without an image from that session, or with an empty requirement', async () => {
      const customer = await newCustomer();
      const first = await sessionWithImage(customer);
      const second = await sessionWithImage(customer);
      await post(first.id, customer, {
        versionId: second.versionId,
        requirement: 'x',
      }).expect(404);
      await post(first.id, customer, { versionId: first.versionId, requirement: '' }).expect(400);
    });

    it('is for the session owner only', async () => {
      const owner = await newCustomer();
      const stranger = await newCustomer();
      const session = await sessionWithImage(owner);
      const body = { versionId: session.versionId, requirement: 'x' };
      await post(session.id, stranger, body).expect(403);
      await request(server()).post(`/design/sessions/${session.id}/tasks`).send(body).expect(401);
    });

    it('blocks AI editing and a second task while waiting', async () => {
      const { customer, session } = await newTask();
      await request(server())
        .post(`/design/sessions/${session.id}/edits`)
        .set(...bearer(customer.token))
        .send({ versionId: session.versionId, request: 'đổi màu' })
        .expect(409);
      await request(server())
        .post(`/design/sessions/${session.id}/main-image`)
        .set(...bearer(customer.token))
        .send({ versionId: session.versionId })
        .expect(409);
      await post(session.id, customer, {
        versionId: session.versionId,
        requirement: 'x',
      }).expect(409);
    });

    it('allows one task when two requests race', async () => {
      const customer = await newCustomer();
      const session = await sessionWithImage(customer);
      const body = { versionId: session.versionId, requirement: 'x' };
      const results = await Promise.all([
        post(session.id, customer, body),
        post(session.id, customer, body),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    });

    it('refuses while an image is being created', async () => {
      const customer = await newCustomer();
      const session = await sessionWithImage(customer);
      const job = await prisma.aiJob.create({
        data: {
          sessionId: session.id,
          customerId: customer.id,
          kind: 'EDIT',
          status: 'RUNNING',
          prompt: 'x',
          referenceFileIds: [],
        },
      });
      await post(session.id, customer, {
        versionId: session.versionId,
        requirement: 'x',
      }).expect(409);
      await prisma.aiJob.delete({ where: { id: job.id } });
    });
  });

  describe('dispatch', () => {
    it('sends to every free designer and nobody else, during hours', async () => {
      const free = await newDesigner();
      const alsoFree = await newDesigner();
      const busy = await newDesigner('BUSY');
      const paused = await newDesigner('PAUSED');
      const { task } = await newTask();
      expect(sentTo(free.id)).toEqual([{ taskId: task.id, designerId: free.id }]);
      expect(sentTo(alsoFree.id)).toHaveLength(1);
      expect(sentTo(busy.id)).toEqual([]);
      expect(sentTo(paused.id)).toEqual([]);
    });

    it('keeps an out-of-hours task waiting, then sends it at 9:00', async () => {
      const designer = await newDesigner();
      now = EVENING;
      const { task } = await newTask();
      expect(sentTo(designer.id)).toEqual([]);

      now = NEXT_MORNING_EARLY;
      await dispatcher.dispatch();
      expect(sentTo(designer.id)).toEqual([]);

      now = NEXT_MORNING_NINE;
      await app.get(DailyDispatchProcessor).process();
      expect(sentTo(designer.id)).toEqual([{ taskId: task.id, designerId: designer.id }]);
    });

    it('registers the 9:00 run in Vietnam time', async () => {
      const queue = app.get<Queue>(getQueueToken(DISPATCH_QUEUE));
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'daily-dispatch',
            pattern: '0 9 * * *',
            tz: 'Asia/Ho_Chi_Minh',
          }),
        ]),
      );
    });

    it('sends oldest first', async () => {
      now = EVENING;
      const older = await newTask();
      now = new Date(EVENING.getTime() + 60_000);
      const newer = await newTask();
      const designer = await newDesigner();
      now = IN_HOURS;
      await dispatcher.dispatch();
      expect(sentTo(designer.id).map((notice) => notice.taskId)).toEqual([
        older.task.id,
        newer.task.id,
      ]);
    });

    it('sends each task once a day, even when dispatch runs in parallel', async () => {
      const designer = await newDesigner();
      await newTask();
      await Promise.all([dispatcher.dispatch(), dispatcher.dispatch(), dispatcher.dispatch()]);
      expect(sentTo(designer.id)).toHaveLength(1);
    });

    it('gives all waiting tasks to a designer who becomes free', async () => {
      const designer = await newDesigner('BUSY');
      const first = await newTask();
      // The clock is fixed, so without this the two tasks tie and their order is random.
      now = new Date(IN_HOURS.getTime() + 60_000);
      const second = await newTask();
      expect(sentTo(designer.id)).toEqual([]);
      await tasks.setFree(designer.id);
      expect(sentTo(designer.id).map((notice) => notice.taskId)).toEqual([
        first.task.id,
        second.task.id,
      ]);
    });

    it('tries a failed notice again on the next dispatch', async () => {
      const designer = await newDesigner();
      sender.failFor.add(designer.id);
      await newTask();
      expect(sentTo(designer.id)).toEqual([]);
      sender.failFor.clear();
      await dispatcher.dispatch();
      expect(sentTo(designer.id)).toHaveLength(1);
    });
  });

  describe('claiming', () => {
    it('gives the task to the first designer, who becomes Busy', async () => {
      const designer = await newDesigner();
      const other = await newDesigner();
      const { task } = await newTask();

      expect(await tasks.claim(designer.id, task.id)).toEqual({ ok: true, taskId: task.id });

      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(stored).toMatchObject({ status: 'ASSIGNED', designerId: designer.id });
      const profile = await prisma.designerProfile.findUniqueOrThrow({
        where: { id: designer.id },
      });
      expect(profile.state).toBe('BUSY');

      expect(await tasks.claim(other.id, task.id)).toEqual({ ok: false, reason: 'already-taken' });
      const loser = await prisma.designerProfile.findUniqueOrThrow({ where: { id: other.id } });
      expect(loser.state).toBe('FREE');
      expect(sender.taken[0].taskId).toBe(task.id);
      expect(sender.taken[0].count).toBeGreaterThan(0);
    });

    it('refuses a designer who is busy or paused', async () => {
      const busy = await newDesigner('BUSY');
      const paused = await newDesigner('PAUSED');
      const { task } = await newTask();
      expect(await tasks.claim(busy.id, task.id)).toEqual({ ok: false, reason: 'designer-busy' });
      expect(await tasks.claim(paused.id, task.id)).toEqual({ ok: false, reason: 'designer-busy' });
    });

    it.each([1, 2, 3, 4, 5])('lets exactly one of 10 win a race on PostgreSQL (round %i)', async () => {
      const designers = await Promise.all(Array.from({ length: 10 }, () => newDesigner()));
      const { task } = await newTask();

      const results = await Promise.all(designers.map((d) => tasks.claim(d.id, task.id)));

      const winners = results.filter((result) => result.ok);
      expect(winners).toHaveLength(1);
      const busy = await prisma.designerProfile.count({
        where: { id: { in: designers.map((d) => d.id) }, state: 'BUSY' },
      });
      expect(busy).toBe(1);
      const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(stored.status).toBe('ASSIGNED');
    });

    it('never gives one designer two tasks, even pressing both at once', async () => {
      const designer = await newDesigner();
      const first = await newTask();
      const second = await newTask();
      const results = await Promise.all([
        tasks.claim(designer.id, first.task.id),
        tasks.claim(designer.id, second.task.id),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, reason: 'designer-busy' },
      ]);
      const assigned = await prisma.task.count({ where: { designerId: designer.id } });
      expect(assigned).toBe(1);
    });

    it('works after 17:00, because hours only limit sending', async () => {
      const designer = await newDesigner();
      const { task } = await newTask();
      now = EVENING;
      expect((await tasks.claim(designer.id, task.id)).ok).toBe(true);
    });

    it('tells the customer live', async () => {
      const designer = await newDesigner();
      const { customer, session, task } = await newTask();
      const socket = io(url, { auth: { token: customer.token }, transports: ['websocket'] });
      try {
        await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
        const event = new Promise((resolve) => socket.once(TASK_EVENT, resolve));
        await tasks.claim(designer.id, task.id);
        await expect(event).resolves.toEqual({ sessionId: session.id, taskId: task.id });
      } finally {
        socket.disconnect();
      }
    });

    it('offers a development route for designers only', async () => {
      const designer = await newDesigner();
      const { customer, task } = await newTask();
      const token = await login(designer.email);
      await request(server())
        .post(`/tasks/${task.id}/dev-claim`)
        .set(...bearer(customer.token))
        .expect(403);
      await request(server()).post(`/tasks/${task.id}/dev-claim`).set(...bearer(token)).expect(200);
      const again = await request(server())
        .post(`/tasks/${task.id}/dev-claim`)
        .set(...bearer(token))
        .expect(409);
      expect(again.body.code).toBe('designer-busy');
    });
  });

  describe('what the customer sees', () => {
    const state = async (sessionId: string, token: string) =>
      (
        await request(server())
          .get(`/design/sessions/${sessionId}/workspace`)
          .set(...bearer(token))
          .expect(200)
      ).body;

    it('explains the wait', async () => {
      // Seeded designers are shared with development, so their states are put back.
      const before = await prisma.designerProfile.findMany({ select: { id: true, state: true } });
      await prisma.designerProfile.updateMany({ data: { state: 'BUSY' } });
      try {
        const { customer, session } = await newTask();
        expect((await state(session.id, customer.token)).task.waitReason).toBe('no-free-designer');
        now = EVENING;
        expect((await state(session.id, customer.token)).task.waitReason).toBe('out-of-hours');
      } finally {
        for (const { id, state: previous } of before) {
          await prisma.designerProfile.update({ where: { id }, data: { state: previous } });
        }
      }
    });

    it('shows who took the task', async () => {
      const designer = await newDesigner();
      const { customer, session, task } = await newTask();
      await tasks.claim(designer.id, task.id);
      const body = await state(session.id, customer.token);
      expect(body.status).toBe('DESIGNER');
      expect(body.task).toMatchObject({
        status: 'ASSIGNED',
        designerName: 'Designer',
        waitReason: null,
      });
    });
  });
});
