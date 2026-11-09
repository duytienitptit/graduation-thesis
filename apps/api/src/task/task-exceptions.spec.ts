import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { Clock } from '../common/clock.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeAdapter } from '../realtime/realtime.adapter.js';
import { DailyDispatchProcessor, TASK_CHECKS_JOB } from './daily-dispatch.js';
import { TaskChecksService, TASK_ALERT_EVENT, waitingForDesignerSince } from './task-checks.service.js';
import { NoticeDesigner, NoticeEndReason, NoticeTask, TaskNoticeSender } from './task-notice-sender.js';
import { TASK_EVENT, TasksService } from './tasks.service.js';

class RecordingSender extends TaskNoticeSender {
  reachable = new Set<string>();
  sent: { taskId: string; designerId: string }[] = [];
  ended: { taskId: string; count: number; reason: NoticeEndReason }[] = [];

  canReach(designer: NoticeDesigner) {
    return this.reachable.has(designer.id);
  }

  async send(designer: NoticeDesigner, task: NoticeTask) {
    this.sent.push({ taskId: task.id, designerId: designer.id });
    return null;
  }

  async markTaken(task: NoticeTask, notices: { id: string }[], reason: NoticeEndReason = 'taken') {
    this.ended.push({ taskId: task.id, count: notices.length, reason });
  }

  async messageWaiting() {}
}

const SPECS = {
  product: { id: 'printed-shirt', name: 'Áo in', shirtType: 'PRINTED' },
  colour: { id: 'white', name: 'Trắng', hex: '#ffffff' },
  material: { id: 'cotton', name: 'Cotton 100%' },
  size: 'M',
  quantity: 1,
};

const HOUR = 60 * 60 * 1000;
// 10:00 on a Monday in Vietnam.
const MONDAY_TEN = new Date('2026-11-09T03:00:00Z');
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe('task exceptions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TasksService;
  let checks: TaskChecksService;
  let files: FilesPort;
  let url: string;
  const sender = new RecordingSender();
  let now = MONDAY_TEN;
  const userIds: string[] = [];
  const designerIds: string[] = [];
  const mine = () => ({ customerId: { in: userIds } });

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;
  const login = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body
      .token as string;

  type Person = { id: string; token: string; designerId?: string };

  async function newUser(role: 'CUSTOMER' | 'DESIGNER' | 'MANAGER'): Promise<Person> {
    const email = `${crypto.randomUUID()}@exceptions.test`;
    const user = await prisma.user.create({
      data: {
        email,
        name: role,
        role,
        ...(role === 'DESIGNER' ? { designer: { create: {} } } : {}),
      },
      include: { designer: true },
    });
    userIds.push(user.id);
    if (user.designer) {
      designerIds.push(user.designer.id);
      sender.reachable.add(user.designer.id);
    }
    return { id: user.id, token: await login(email), designerId: user.designer?.id };
  }

  const post = (who: Person, path: string, body: object = {}) =>
    request(server())
      .post(path)
      .set(...bearer(who.token))
      .send(body);

  const image = (ownerId: string) =>
    files.saveImage(ownerId, { mimeType: 'image/png', data: Buffer.from('image') });

  async function answeredSession(customer: Person) {
    const session = await prisma.designSession.create({
      data: { customerId: customer.id, specSnapshot: SPECS, status: 'ANSWERED' },
    });
    const version = await prisma.designVersion.create({
      data: { sessionId: session.id, fileId: await image(customer.id), source: 'AI' },
    });
    return { sessionId: session.id, versionId: version.id };
  }

  async function waitingTask(customer?: Person) {
    const owner = customer ?? (await newUser('CUSTOMER'));
    const { sessionId, versionId } = await answeredSession(owner);
    const res = await post(owner, `/design/sessions/${sessionId}/tasks`, {
      versionId,
      requirement: 'Giúp mình với',
    }).expect(201);
    return { customer: owner, sessionId, taskId: res.body.id as string };
  }

  async function takenTask() {
    const room = await waitingTask();
    const designer = await newUser('DESIGNER');
    expect((await tasks.claim(designer.designerId!, room.taskId)).ok).toBe(true);
    return { ...room, designer };
  }

  /** A session at the views step: front approved, back waiting for approval, close-up approved. */
  async function viewsSession() {
    const customer = await newUser('CUSTOMER');
    const session = await prisma.designSession.create({
      data: { customerId: customer.id, specSnapshot: SPECS, status: 'VIEWS' },
    });
    const version = async () =>
      (
        await prisma.designVersion.create({
          data: { sessionId: session.id, fileId: await image(customer.id), source: 'AI' },
        })
      ).id;
    const front = await prisma.productView.create({
      data: { sessionId: session.id, type: 'FRONT', versionId: await version(), status: 'APPROVED' },
    });
    const back = await prisma.productView.create({
      data: { sessionId: session.id, type: 'BACK', versionId: await version(), status: 'READY' },
    });
    await prisma.productView.create({
      data: {
        sessionId: session.id,
        type: 'CLOSE_UP',
        versionId: await version(),
        status: 'APPROVED',
      },
    });
    return { customer, sessionId: session.id, front, back };
  }

  const task = (id: string) =>
    prisma.task.findUniqueOrThrow({ where: { id }, include: { designer: true, session: true } });
  const run = () => checks.run({ customerId: { in: userIds } });

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
    checks = app.get(TaskChecksService);
    files = app.get(FilesPort);
  });

  beforeEach(async () => {
    now = MONDAY_TEN;
    sender.sent = [];
    sender.ended = [];
    // A free designer from an earlier test would take part in later dispatches.
    await prisma.designerProfile.updateMany({
      where: { id: { in: designerIds }, state: 'FREE' },
      data: { state: 'PAUSED' },
    });
  });

  afterAll(async () => {
    const customer = mine();
    await prisma.taskMessage.deleteMany({ where: { task: customer } });
    await prisma.taskNotice.deleteMany({
      where: { OR: [{ task: customer }, { designerId: { in: designerIds } }] },
    });
    await prisma.task.deleteMany({ where: customer });
    await prisma.lockedProduct.deleteMany({ where: { session: customer } });
    await prisma.aiJob.deleteMany({ where: customer });
    await prisma.productView.deleteMany({ where: { session: customer } });
    await prisma.designVersion.updateMany({
      where: { session: customer },
      data: { parentVersionId: null },
    });
    await prisma.designVersion.deleteMany({ where: { session: customer } });
    await prisma.designSession.deleteMany({ where: customer });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.designerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  describe('nobody takes the task', () => {
    async function offeredTask() {
      await newUser('DESIGNER').then((designer) =>
        prisma.designerProfile.update({
          where: { id: designer.designerId },
          data: { state: 'FREE' },
        }),
      );
      const room = await waitingTask();
      expect(await prisma.taskNotice.count({ where: { taskId: room.taskId } })).toBeGreaterThan(0);
      return room;
    }

    it('tells the customer once, after 2 working hours from the first Telegram message', async () => {
      const room = await offeredTask();
      const socket = io(url, { auth: { token: room.customer.token }, transports: ['websocket'] });
      const events: { taskId: string }[] = [];
      socket.on(TASK_EVENT, (event) => events.push(event));
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

      now = at(MONDAY_TEN, 2 * HOUR - 60_000);
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toBeNull();

      now = at(MONDAY_TEN, 2 * HOUR);
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toEqual(now);

      const later = now;
      now = at(MONDAY_TEN, 5 * HOUR);
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toEqual(later);

      const workspace = await request(server())
        .get(`/design/sessions/${room.sessionId}/workspace`)
        .set(...bearer(room.customer.token))
        .expect(200);
      expect(workspace.body.task.noTakerNotice).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(events.filter((event) => event.taskId === room.taskId)).toHaveLength(1);
      socket.disconnect();
    });

    it('counts only working hours, across the night', async () => {
      now = at(MONDAY_TEN, 6 * HOUR); // 16:00
      const room = await offeredTask();

      now = new Date('2026-11-10T02:30:00Z'); // 09:30 the next day: 1.5 working hours
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toBeNull();

      now = new Date('2026-11-10T03:00:00Z'); // 10:00: 2 working hours
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toEqual(now);
    });

    it('waits for a first message: a task created out of hours has none until 9:00', async () => {
      now = new Date('2026-11-09T13:00:00Z'); // 20:00
      const room = await waitingTask();
      now = new Date('2026-11-10T01:00:00Z'); // 08:00 next day
      await run();
      expect((await task(room.taskId)).noTakerNoticeAt).toBeNull();
    });

    it('runs from the scheduled job too', async () => {
      const room = await offeredTask();
      now = at(MONDAY_TEN, 3 * HOUR);
      // The scheduled job checks every task, so it uses the test's own clock here.
      await app.get(DailyDispatchProcessor).process({ name: TASK_CHECKS_JOB } as never);
      expect((await task(room.taskId)).noTakerNoticeAt).toEqual(now);
    });
  });

  describe('the customer cancels', () => {
    it('only after 48 hours, and only their own waiting task', async () => {
      const room = await waitingTask();
      now = at(MONDAY_TEN, 48 * HOUR - 60_000);
      const early = await post(room.customer, `/tasks/${room.taskId}/cancel`).expect(409);
      expect(early.body.code).toBe('too-early');

      const stranger = await newUser('CUSTOMER');
      now = at(MONDAY_TEN, 48 * HOUR);
      await post(stranger, `/tasks/${room.taskId}/cancel`).expect(403);
      await post(room.customer, `/tasks/${room.taskId}/cancel`).expect(204);

      const cancelled = await task(room.taskId);
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledAt: now });
      expect(cancelled.session.status).toBe('ANSWERED');
      expect(sender.ended).toContainEqual(
        expect.objectContaining({ taskId: room.taskId, reason: 'cancelled' }),
      );
    });

    it('cannot cancel a task a designer took', async () => {
      const room = await takenTask();
      now = at(MONDAY_TEN, 72 * HOUR);
      const res = await post(room.customer, `/tasks/${room.taskId}/cancel`).expect(409);
      expect(res.body.code).toBe('not-waiting');
    });

    it('can edit with AI or ask a designer again afterwards', async () => {
      const room = await waitingTask();
      now = at(MONDAY_TEN, 49 * HOUR);
      await post(room.customer, `/tasks/${room.taskId}/cancel`).expect(204);

      const version = await prisma.designVersion.findFirstOrThrow({
        where: { sessionId: room.sessionId },
      });
      await post(room.customer, `/design/sessions/${room.sessionId}/tasks`, {
        versionId: version.id,
        requirement: 'Thử lại',
      }).expect(201);
    });
  });

  describe('the designer goes silent', () => {
    let manager: Person;
    beforeAll(async () => {
      manager = await newUser('MANAGER');
    });

    async function say(who: Person, taskId: string, text: string) {
      await post(who, `/tasks/${taskId}/messages`, { text }).expect(201);
    }

    it('alerts managers once after 24 hours with nothing from the designer', async () => {
      const room = await takenTask();
      const socket = io(url, { auth: { token: manager.token }, transports: ['websocket'] });
      const alerts: { taskId: string }[] = [];
      socket.on(TASK_ALERT_EVENT, (alert) => alerts.push(alert));
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

      now = at(MONDAY_TEN, 24 * HOUR - 60_000);
      await run();
      expect((await task(room.taskId)).silenceAlertAt).toBeNull();

      now = at(MONDAY_TEN, 24 * HOUR);
      await run();
      await run();
      expect((await task(room.taskId)).silenceAlertAt).toEqual(now);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alerts.filter((alert) => alert.taskId === room.taskId)).toHaveLength(1);
      socket.disconnect();
    });

    it('does not count while it is the customer\'s turn', async () => {
      const room = await takenTask();
      await say(room.designer, room.taskId, 'Bạn muốn màu gì?');
      now = at(MONDAY_TEN, 30 * HOUR);
      await run();
      expect((await task(room.taskId)).silenceAlertAt).toBeNull();
    });

    it('counts from the customer\'s oldest unanswered message, and a reply clears the alert', async () => {
      const room = await takenTask();
      await say(room.designer, room.taskId, 'Chào');
      now = at(MONDAY_TEN, HOUR);
      await say(room.customer, room.taskId, 'Màu đỏ');
      now = at(MONDAY_TEN, 5 * HOUR);
      await say(room.customer, room.taskId, 'Bạn ơi?');

      now = at(MONDAY_TEN, 25 * HOUR - 60_000);
      await run();
      expect((await task(room.taskId)).silenceAlertAt).toBeNull();
      now = at(MONDAY_TEN, 25 * HOUR);
      await run();
      expect((await task(room.taskId)).silenceAlertAt).toEqual(now);

      await say(room.designer, room.taskId, 'Xin lỗi, mình đây');
      expect((await task(room.taskId)).silenceAlertAt).toBeNull();
    });

    it('counts an "Agree" the designer has not answered', () => {
      const designerAt = new Date('2026-11-09T03:00:00Z');
      const agreedAt = new Date('2026-11-09T04:00:00Z');
      expect(
        waitingForDesignerSince({
          assignedAt: new Date('2026-11-09T02:00:00Z'),
          agreedAt,
          customerId: 'c',
          designer: { userId: 'd' },
          messages: [{ senderId: 'd', createdAt: designerAt }],
        }),
      ).toEqual(agreedAt);
    });
  });

  describe('the designer closes the task', () => {
    it('needs a reason, and only the task\'s designer can do it', async () => {
      const room = await takenTask();
      await post(room.designer, `/tasks/${room.taskId}/close`, { reason: '   ' }).expect(400);
      await post(room.customer, `/tasks/${room.taskId}/close`, { reason: 'x' }).expect(403);
      const other = await newUser('DESIGNER');
      await post(other, `/tasks/${room.taskId}/close`, { reason: 'x' }).expect(403);
    });

    it('frees the designer, shows the reason, closes the chat and returns the session to AI', async () => {
      const room = await takenTask();
      await post(room.designer, `/tasks/${room.taskId}/close`, {
        reason: 'Khách không trả lời 3 ngày',
      }).expect(204);

      const closed = await task(room.taskId);
      expect(closed).toMatchObject({
        status: 'CLOSED',
        closedAt: now,
        closeReason: 'Khách không trả lời 3 ngày',
      });
      expect(closed.designer!.state).toBe('FREE');
      expect(closed.session.status).toBe('ANSWERED');

      const workspace = await request(server())
        .get(`/design/sessions/${room.sessionId}/workspace`)
        .set(...bearer(room.customer.token))
        .expect(200);
      expect(workspace.body.task).toMatchObject({
        status: 'CLOSED',
        closeReason: 'Khách không trả lời 3 ngày',
      });

      await post(room.customer, `/tasks/${room.taskId}/messages`, { text: 'x' }).expect(409);
      await post(room.designer, `/tasks/${room.taskId}/close`, { reason: 'x' }).expect(409);

      const list = await request(server())
        .get('/designers/me/tasks')
        .set(...bearer(room.designer.token))
        .expect(200);
      expect(list.body.current).toBeNull();
      expect(list.body.past[0]).toMatchObject({ id: room.taskId, status: 'CLOSED' });
    });

    it('gives the freed designer the waiting tasks', async () => {
      const room = await takenTask();
      const waiting = await waitingTask();
      await post(room.designer, `/tasks/${room.taskId}/close`, { reason: 'Khách im lặng' }).expect(204);
      expect(sender.sent).toContainEqual({
        taskId: waiting.taskId,
        designerId: room.designer.designerId,
      });
    });
  });

  describe('a task for one view', () => {
    const createFor = (room: Awaited<ReturnType<typeof viewsSession>>, viewId: string) =>
      post(room.customer, `/design/sessions/${room.sessionId}/views/${viewId}/tasks`, {
        requirement: 'Mặt sau bị lệch chữ',
      });

    it('cannot target the front, an approved view, or a view that already has a designer', async () => {
      const room = await viewsSession();
      expect((await createFor(room, room.front.id).expect(409)).body.code).toBe('front-view');
      const closeUp = await prisma.productView.findFirstOrThrow({
        where: { sessionId: room.sessionId, type: 'CLOSE_UP' },
      });
      expect((await createFor(room, closeUp.id).expect(409)).body.code).toBe('view-approved');

      await createFor(room, room.back.id).expect(201);
      expect((await createFor(room, room.back.id).expect(409)).body.code).toBe(
        'view-with-designer',
      );
    });

    it('keeps the session at the views step, and blocks only that view and locking', async () => {
      const room = await viewsSession();
      const res = await createFor(room, room.back.id).expect(201);
      expect(res.body.referenceVersionId).toBe(room.front.versionId);
      expect((await task(res.body.id)).session.status).toBe('VIEWS');

      const path = `/design/sessions/${room.sessionId}`;
      await post(room.customer, `${path}/views/${room.back.id}/approve`).expect(409);
      await post(room.customer, `${path}/views/${room.back.id}/regenerate`).expect(409);
      const lock = await post(room.customer, `${path}/lock`).expect(409);
      expect(lock.body.code).toBe('view-with-designer');

      const workspace = await request(server())
        .get(`${path}/workspace`)
        .set(...bearer(room.customer.token))
        .expect(200);
      const back = workspace.body.views.find((view: { type: string }) => view.type === 'BACK');
      expect(back.task).toMatchObject({ id: res.body.id, status: 'WAITING' });
      expect(workspace.body.task).toBeNull();
    });

    it('needs no Agree or back content, and Done puts the image in the view for approval', async () => {
      const room = await viewsSession();
      const created = await createFor(room, room.back.id).expect(201);
      const designer = await newUser('DESIGNER');
      expect((await tasks.claim(designer.designerId!, created.body.id)).ok).toBe(true);

      const final = await post(designer, `/tasks/${created.body.id}/final`, {
        fileId: await image(designer.id),
      }).expect(201);
      await post(designer, `/tasks/${created.body.id}/done`).expect(204);

      const done = await task(created.body.id);
      expect(done.status).toBe('DONE');
      expect(done.designer!.state).toBe('FREE');
      expect(done.session.status).toBe('VIEWS');
      const back = await prisma.productView.findUniqueOrThrow({ where: { id: room.back.id } });
      expect(back).toMatchObject({ versionId: final.body.versionId, status: 'READY' });

      const path = `/design/sessions/${room.sessionId}`;
      await post(room.customer, `${path}/views/${room.back.id}/approve`).expect(200);
      const locked = await post(room.customer, `${path}/lock`).expect(201);
      const product = await request(server())
        .get(`/design/locked-products/${locked.body.id}`)
        .set(...bearer(room.customer.token))
        .expect(200);
      const backView = product.body.views.find((view: { type: string }) => view.type === 'BACK');
      expect(backView.source).toBe('DESIGNER');
    });

    it('leaves the view as it was when the designer closes or the customer cancels', async () => {
      const closedRoom = await viewsSession();
      const created = await createFor(closedRoom, closedRoom.back.id).expect(201);
      const designer = await newUser('DESIGNER');
      expect((await tasks.claim(designer.designerId!, created.body.id)).ok).toBe(true);
      await post(designer, `/tasks/${created.body.id}/close`, { reason: 'Khách im lặng' }).expect(204);
      expect((await task(created.body.id)).session.status).toBe('VIEWS');
      await post(
        closedRoom.customer,
        `/design/sessions/${closedRoom.sessionId}/views/${closedRoom.back.id}/approve`,
      ).expect(200);

      const cancelRoom = await viewsSession();
      const waiting = await createFor(cancelRoom, cancelRoom.back.id).expect(201);
      now = at(MONDAY_TEN, 48 * HOUR);
      await post(cancelRoom.customer, `/tasks/${waiting.body.id}/cancel`).expect(204);
      expect((await task(waiting.body.id)).session.status).toBe('VIEWS');
      await post(
        cancelRoom.customer,
        `/design/sessions/${cancelRoom.sessionId}/views/${cancelRoom.back.id}/approve`,
      ).expect(200);
    });
  });

  describe('no designer stays Busy', () => {
    it('leaves no Busy designer of these tests without an open task', async () => {
      const stuck = await prisma.designerProfile.findMany({
        where: {
          id: { in: designerIds },
          state: 'BUSY',
          tasks: { none: { status: 'ASSIGNED' } },
        },
      });
      expect(stuck).toEqual([]);
    });

    it('frees the designer on every way a taken task ends', async () => {
      // Done on a whole-shirt task is covered in the chat tests, and on a view task above.
      const closed = await takenTask();
      await post(closed.designer, `/tasks/${closed.taskId}/close`, { reason: 'x' }).expect(204);

      const viewRoom = await viewsSession();
      const viewTask = await post(
        viewRoom.customer,
        `/design/sessions/${viewRoom.sessionId}/views/${viewRoom.back.id}/tasks`,
        { requirement: 'x' },
      ).expect(201);
      const designer = await newUser('DESIGNER');
      expect((await tasks.claim(designer.designerId!, viewTask.body.id)).ok).toBe(true);
      await post(designer, `/tasks/${viewTask.body.id}/final`, {
        fileId: await image(designer.id),
      }).expect(201);
      await post(designer, `/tasks/${viewTask.body.id}/done`).expect(204);

      const states = await prisma.designerProfile.findMany({
        where: { id: { in: [closed.designer.designerId!, designer.designerId!] } },
      });
      expect(states.map((state) => state.state)).toEqual(['FREE', 'FREE']);
    });
  });
});
