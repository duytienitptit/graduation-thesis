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
import { NoticeDesigner, TaskNoticeSender } from '../task/task-notice-sender.js';
import { TASK_EVENT, TasksService } from '../task/tasks.service.js';
import { CHAT_NOTICE_GAP_MS, MESSAGE_EVENT } from './chat.service.js';

class RecordingSender extends TaskNoticeSender {
  chatNotices: string[] = [];

  canReach(designer: NoticeDesigner) {
    return designer.id === 'nobody';
  }

  async send() {
    return null;
  }

  async markTaken() {}

  async messageWaiting(_designer: NoticeDesigner, task: { id: string }) {
    this.chatNotices.push(task.id);
  }
}

const SPECS = {
  product: { id: 'printed-shirt', name: 'Áo in', shirtType: 'PRINTED' },
  colour: { id: 'white', name: 'Trắng', hex: '#ffffff' },
  material: { id: 'cotton', name: 'Cotton 100%' },
  size: 'M',
  quantity: 2,
};
const ANSWERS = { main_image: 'Con mèo', back_print: 'plain' };

const WAIT_MS = 5000;

describe('chat and completion', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tasks: TasksService;
  let files: FilesPort;
  let url: string;
  const sender = new RecordingSender();
  let now = new Date('2026-11-09T03:00:00Z');
  const userIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;
  const login = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body
      .token as string;

  async function newUser(role: 'CUSTOMER' | 'DESIGNER' | 'MANAGER') {
    const email = `${crypto.randomUUID()}@chat.test`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `Người ${role}`,
        role,
        ...(role === 'DESIGNER' ? { designer: { create: {} } } : {}),
      },
      include: { designer: true },
    });
    userIds.push(user.id);
    return { id: user.id, token: await login(email), designerId: user.designer?.id };
  }

  async function storedFile(ownerId: string, mimeType = 'image/png') {
    if (mimeType === 'image/png') {
      return files.saveImage(ownerId, { mimeType, data: Buffer.from('image') });
    }
    const file = await prisma.fileObject.create({
      data: {
        ownerId,
        storageKey: `test/${crypto.randomUUID()}.pdf`,
        mimeType,
        size: 1,
        purpose: 'CHAT',
        status: 'READY',
      },
    });
    return file.id;
  }

  /** A task a designer has taken, built directly so these tests stay on the chat. */
  async function takenTask() {
    const customer = await newUser('CUSTOMER');
    const designer = await newUser('DESIGNER');
    const session = await prisma.designSession.create({
      data: {
        customerId: customer.id,
        specSnapshot: SPECS,
        answers: ANSWERS,
        status: 'DESIGNER',
      },
    });
    const version = await prisma.designVersion.create({
      data: {
        sessionId: session.id,
        fileId: await storedFile(customer.id),
        source: 'AI',
      },
    });
    const task = await prisma.task.create({
      data: {
        sessionId: session.id,
        customerId: customer.id,
        requirement: 'Làm lại logo',
        referenceVersionId: version.id,
      },
    });
    const claimed = await tasks.claim(designer.designerId!, task.id);
    expect(claimed.ok).toBe(true);
    return { customer, designer, sessionId: session.id, taskId: task.id };
  }

  type Person = { token: string };
  const get = (who: Person, path: string) =>
    request(server())
      .get(path)
      .set(...bearer(who.token));
  const post = (who: Person, path: string, body: object = {}) =>
    request(server())
      .post(path)
      .set(...bearer(who.token))
      .send(body);

  async function sample(room: Awaited<ReturnType<typeof takenTask>>) {
    const res = await post(room.designer, `/tasks/${room.taskId}/samples`, {
      fileId: await storedFile(room.designer.id),
    }).expect(201);
    return res.body.versionId as string;
  }

  async function agreedRoom() {
    const room = await takenTask();
    const versionId = await sample(room);
    await post(room.customer, `/tasks/${room.taskId}/agree`, { versionId }).expect(204);
    return { ...room, versionId };
  }

  async function finalRoom(back: object = { backDescription: 'In chữ "ĐỘI A" ở lưng' }) {
    const room = await agreedRoom();
    const res = await post(room.designer, `/tasks/${room.taskId}/final`, {
      fileId: await storedFile(room.designer.id),
      ...back,
    }).expect(201);
    return { ...room, finalVersionId: res.body.versionId as string };
  }

  const waitFor = async <T>(read: () => Promise<T | null | undefined | false>) => {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) throw new Error('Timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

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
    files = app.get(FilesPort);
  });

  beforeEach(() => {
    sender.chatNotices = [];
  });

  afterAll(async () => {
    // The queue worker may still be finishing a view.
    await waitFor(async () => {
      const active = await prisma.aiJob.count({
        where: { customerId: { in: userIds }, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      return active === 0;
    });
    const customer = { customerId: { in: userIds } };
    await prisma.taskMessage.deleteMany({ where: { task: customer } });
    await prisma.taskNotice.deleteMany({ where: { task: customer } });
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

  describe('who can see a task', () => {
    it('shows the designer everything they need, and the task in their list', async () => {
      const room = await takenTask();
      const res = await get(room.designer, `/tasks/${room.taskId}`).expect(200);
      expect(res.body).toMatchObject({
        side: 'DESIGNER',
        requirement: 'Làm lại logo',
        product: { name: 'Áo in', colour: 'Trắng', size: 'M', quantity: 2 },
      });
      expect(res.body.answers).toContainEqual(expect.objectContaining({ text: 'Con mèo' }));
      expect((await fetch(res.body.referenceImageUrl)).status).toBe(200);

      const list = await get(room.designer, '/designers/me/tasks').expect(200);
      expect(list.body.current).toMatchObject({ id: room.taskId, productName: 'Áo in' });
      expect(list.body.past).toEqual([]);
    });

    it('refuses other customers and designers, and lets a manager read but not write', async () => {
      const room = await takenTask();
      const stranger = await newUser('CUSTOMER');
      const otherDesigner = await newUser('DESIGNER');
      const manager = await newUser('MANAGER');

      await get(stranger, `/tasks/${room.taskId}`).expect(403);
      await get(otherDesigner, `/tasks/${room.taskId}`).expect(403);
      await get(stranger, `/tasks/${room.taskId}/messages`).expect(403);
      await post(otherDesigner, `/tasks/${room.taskId}/messages`, { text: 'x' }).expect(403);

      await get(manager, `/tasks/${room.taskId}/messages`).expect(200);
      await post(manager, `/tasks/${room.taskId}/messages`, { text: 'x' }).expect(403);
    });

    it('answers 404 for an unknown task', async () => {
      const room = await takenTask();
      await get(room.customer, `/tasks/${crypto.randomUUID()}`).expect(404);
    });
  });

  describe('messages', () => {
    it('stores text and files, in order, for both sides', async () => {
      const room = await takenTask();
      const pdf = await storedFile(room.customer.id, 'application/pdf');

      await post(room.customer, `/tasks/${room.taskId}/messages`, { text: ' Chào bạn ' }).expect(201);
      now = new Date(now.getTime() + 1000);
      await post(room.customer, `/tasks/${room.taskId}/messages`, { fileId: pdf }).expect(201);
      now = new Date(now.getTime() + 1000);
      await post(room.designer, `/tasks/${room.taskId}/messages`, { text: 'Chào' }).expect(201);

      const res = await get(room.designer, `/tasks/${room.taskId}/messages`).expect(200);
      expect(res.body.map((m: { kind: string }) => m.kind)).toEqual(['TEXT', 'FILE', 'TEXT']);
      expect(res.body[0]).toMatchObject({ text: 'Chào bạn', senderRole: 'CUSTOMER' });
      expect(res.body[1].attachment.mimeType).toBe('application/pdf');
      expect(res.body[2].senderRole).toBe('DESIGNER');
    });

    it('refuses an empty message and someone else\'s file', async () => {
      const room = await takenTask();
      const path = `/tasks/${room.taskId}/messages`;
      await post(room.customer, path, { text: '   ' }).expect(400);
      await post(room.customer, path, {
        fileId: await storedFile(room.designer.id),
      }).expect(400);
    });

    it('pushes a message live to both people, and nobody else', async () => {
      const room = await takenTask();
      const stranger = await newUser('CUSTOMER');
      const connect = (who: Person) => {
        const socket = io(url, { auth: { token: who.token }, transports: ['websocket'] });
        const received: { text: string }[] = [];
        socket.on(MESSAGE_EVENT, (message) => received.push(message));
        return { socket, received };
      };
      const people = [connect(room.customer), connect(room.designer), connect(stranger)];
      await Promise.all(
        people.map(
          ({ socket }) => new Promise<void>((resolve) => socket.on('connect', () => resolve())),
        ),
      );

      await post(room.customer, `/tasks/${room.taskId}/messages`, { text: 'Có ai không?' }).expect(201);

      await waitFor(async () => people[0].received.length && people[1].received.length);
      expect(people[1].received[0].text).toBe('Có ai không?');
      expect(people[2].received).toEqual([]);
      people.forEach(({ socket }) => socket.disconnect());
    });

    it('tells the designer at most once per 10 minutes, and never about their own message', async () => {
      const room = await takenTask();
      const path = `/tasks/${room.taskId}/messages`;

      await post(room.designer, path, { text: 'Chào' }).expect(201);
      expect(sender.chatNotices).toEqual([]);

      await post(room.customer, path, { text: '1' }).expect(201);
      await post(room.customer, path, { text: '2' }).expect(201);
      expect(sender.chatNotices).toEqual([room.taskId]);

      now = new Date(now.getTime() + CHAT_NOTICE_GAP_MS);
      await post(room.customer, path, { text: '3' }).expect(201);
      expect(sender.chatNotices).toEqual([room.taskId, room.taskId]);
    });
  });

  describe('samples and Agree', () => {
    it('shows a sample in chat, and only the designer can send one', async () => {
      const room = await takenTask();
      const fileId = await storedFile(room.designer.id);
      await post(room.customer, `/tasks/${room.taskId}/samples`, { fileId }).expect(403);

      const versionId = await sample(room);
      const res = await get(room.customer, `/tasks/${room.taskId}/messages`).expect(200);
      expect(res.body[0]).toMatchObject({ kind: 'SAMPLE', versionId });
      expect((await fetch(res.body[0].imageUrl)).status).toBe(200);
    });

    it('refuses a PDF as a sample', async () => {
      const room = await takenTask();
      await post(room.designer, `/tasks/${room.taskId}/samples`, {
        fileId: await storedFile(room.designer.id, 'application/pdf'),
      }).expect(400);
    });

    it('keeps samples out of the AI version list, and lets the customer see the workspace', async () => {
      const room = await takenTask();
      await sample(room);
      const res = await get(room.customer, `/design/sessions/${room.sessionId}/workspace`).expect(200);
      expect(res.body.versions).toHaveLength(1);
      expect(res.body.versions[0].source).toBe('AI');
    });

    it('agrees only as the customer, and only to a sample of this task', async () => {
      const room = await takenTask();
      const other = await takenTask();
      const versionId = await sample(room);
      const foreign = await sample(other);
      const path = `/tasks/${room.taskId}/agree`;

      await post(room.designer, path, { versionId }).expect(403);
      await post(room.customer, path, { versionId: foreign }).expect(404);
      await post(room.customer, path, { versionId }).expect(204);

      const task = await prisma.task.findUniqueOrThrow({ where: { id: room.taskId } });
      expect(task.agreedVersionId).toBe(versionId);
      expect(sender.chatNotices).toContain(room.taskId);
    });

    it('agrees to an older sample too', async () => {
      const room = await takenTask();
      const first = await sample(room);
      await sample(room);
      await post(room.customer, `/tasks/${room.taskId}/agree`, { versionId: first }).expect(204);
    });

    it('cancels Agree and the final when a new sample arrives', async () => {
      const room = await finalRoom();
      await sample(room);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: room.taskId } });
      expect(task).toMatchObject({
        agreedVersionId: null,
        agreedAt: null,
        finalVersionId: null,
        backDescription: null,
      });
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(409);
    });

    it('drops the final when the customer agrees to another sample', async () => {
      const room = await takenTask();
      const first = await sample(room);
      const second = await sample(room);
      await post(room.customer, `/tasks/${room.taskId}/agree`, { versionId: first }).expect(204);
      await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backDescription: 'Trơn',
      }).expect(201);

      await post(room.customer, `/tasks/${room.taskId}/agree`, { versionId: second }).expect(204);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: room.taskId } });
      expect(task).toMatchObject({ agreedVersionId: second, finalVersionId: null });
    });
  });

  describe('the final', () => {
    it('needs a standing Agree', async () => {
      const room = await takenTask();
      await sample(room);
      const res = await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backDescription: 'Trơn',
      }).expect(409);
      expect(res.body.code).toBe('not-agreed');
      // The refused final leaves no image behind.
      expect(
        await prisma.designVersion.count({ where: { sessionId: room.sessionId, source: 'DESIGNER' } }),
      ).toBe(1);
    });

    it('needs back content', async () => {
      const room = await agreedRoom();
      const res = await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backDescription: '   ',
      }).expect(400);
      expect(res.body.code).toBe('back-required');
    });

    it('takes a back image instead of a description, and shows it in chat', async () => {
      const room = await agreedRoom();
      const backFileId = await storedFile(room.designer.id);
      await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backFileId,
      }).expect(201);

      const res = await get(room.customer, `/tasks/${room.taskId}/messages`).expect(200);
      const final = res.body.at(-1);
      expect(final.kind).toBe('FINAL');
      expect(final.attachment.mimeType).toBe('image/png');

      const detail = await get(room.customer, `/tasks/${room.taskId}`).expect(200);
      expect(detail.body.backImageUrl).toEqual(expect.any(String));
      expect(detail.body.finalImageUrl).toEqual(expect.any(String));
    });

    it('can be sent again, and the newest counts', async () => {
      const room = await finalRoom();
      const res = await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backDescription: 'Bản mới',
      }).expect(201);
      const task = await prisma.task.findUniqueOrThrow({ where: { id: room.taskId } });
      expect(task).toMatchObject({
        finalVersionId: res.body.versionId,
        backDescription: 'Bản mới',
      });
    });
  });

  describe('Done', () => {
    it('needs Agree and the final, and only the task\'s designer can press it', async () => {
      const room = await agreedRoom();
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(409);

      await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backDescription: 'Trơn',
      }).expect(201);
      const stranger = await newUser('DESIGNER');
      await post(stranger, `/tasks/${room.taskId}/done`).expect(403);
      await post(room.customer, `/tasks/${room.taskId}/done`).expect(403);

      const designer = await prisma.designerProfile.findUniqueOrThrow({
        where: { id: room.designer.designerId },
      });
      expect(designer.state).toBe('BUSY');
    });

    it('ends the task, frees the designer and starts the views from the final', async () => {
      const room = await finalRoom();
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);

      const task = await prisma.task.findUniqueOrThrow({
        where: { id: room.taskId },
        include: { designer: true, session: true },
      });
      expect(task.status).toBe('DONE');
      expect(task.doneAt).toEqual(now);
      expect(task.designer!.state).toBe('FREE');
      expect(task.session.status).toBe('VIEWS');

      const views = await prisma.productView.findMany({ where: { sessionId: room.sessionId } });
      expect(views.map((view) => view.type).sort()).toEqual(['BACK', 'CLOSE_UP', 'FRONT']);
      expect(views.find((view) => view.type === 'FRONT')).toMatchObject({
        versionId: room.finalVersionId,
        status: 'APPROVED',
      });

      const job = await prisma.aiJob.findFirstOrThrow({
        where: { sessionId: room.sessionId, view: { type: 'BACK' } },
      });
      expect(job.customerId).toBe(room.customer.id);
      expect(job.parentVersionId).toBe(room.finalVersionId);
      expect(job.prompt).toContain('In chữ "ĐỘI A" ở lưng');
    });

    it('sends the designer\'s back image to the image API as a reference', async () => {
      const backFileId = crypto.randomUUID();
      const room = await agreedRoom();
      await prisma.fileObject.create({
        data: {
          id: backFileId,
          ownerId: room.designer.id,
          storageKey: `test/${backFileId}.png`,
          mimeType: 'image/png',
          size: 1,
          purpose: 'FINAL_DESIGN',
          status: 'READY',
        },
      });
      await post(room.designer, `/tasks/${room.taskId}/final`, {
        fileId: await storedFile(room.designer.id),
        backFileId,
      }).expect(201);
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);

      const job = await prisma.aiJob.findFirstOrThrow({
        where: { sessionId: room.sessionId, view: { type: 'BACK' } },
      });
      expect(job.referenceFileIds).toEqual([backFileId]);
    });

    it('cannot be pressed twice, and the chat closes', async () => {
      const room = await finalRoom();
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(409);
      await post(room.customer, `/tasks/${room.taskId}/messages`, { text: 'x' }).expect(409);
      await post(room.designer, `/tasks/${room.taskId}/samples`, {
        fileId: await storedFile(room.designer.id),
      }).expect(409);

      const list = await get(room.designer, '/designers/me/tasks').expect(200);
      expect(list.body.current).toBeNull();
      expect(list.body.past[0].id).toBe(room.taskId);
      await get(room.customer, `/tasks/${room.taskId}/messages`).expect(200);
    });

    it('leaves a paused designer paused', async () => {
      const room = await finalRoom();
      await prisma.designerProfile.update({
        where: { id: room.designer.designerId },
        data: { state: 'PAUSED' },
      });
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);
      const designer = await prisma.designerProfile.findUniqueOrThrow({
        where: { id: room.designer.designerId },
      });
      expect(designer.state).toBe('PAUSED');
    });

    it('still finishes when the customer is out of credits, leaving the views to wait', async () => {
      const room = await finalRoom();
      await prisma.aiJob.createMany({
        data: Array.from({ length: 20 }, () => ({
          sessionId: room.sessionId,
          customerId: room.customer.id,
          kind: 'CREATE' as const,
          status: 'DONE' as const,
          prompt: 'x',
          createdAt: now,
        })),
      });
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);

      const views = await prisma.productView.findMany({ where: { sessionId: room.sessionId } });
      expect(views.filter((view) => view.status === 'PENDING')).toHaveLength(2);
      const designer = await prisma.designerProfile.findUniqueOrThrow({
        where: { id: room.designer.designerId },
      });
      expect(designer.state).toBe('FREE');
    });

    it('tells both people, so their pages move on', async () => {
      const room = await finalRoom();
      const socket = io(url, { auth: { token: room.customer.token }, transports: ['websocket'] });
      const events: { taskId: string }[] = [];
      socket.on(TASK_EVENT, (event) => events.push(event));
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));

      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);
      await waitFor(async () => events.length > 0);
      expect(events[0].taskId).toBe(room.taskId);
      socket.disconnect();
    });

    it('runs from the final to a locked product', async () => {
      const room = await finalRoom();
      await post(room.designer, `/tasks/${room.taskId}/done`).expect(204);

      const ready = (type: 'BACK' | 'CLOSE_UP') =>
        waitFor(() =>
          prisma.productView.findFirst({
            where: { sessionId: room.sessionId, type, status: 'READY' },
          }),
        );
      for (const view of [await ready('BACK'), await ready('CLOSE_UP')]) {
        await post(
          room.customer,
          `/design/sessions/${room.sessionId}/views/${view.id}/approve`,
        ).expect(200);
      }
      const workspace = await get(
        room.customer,
        `/design/sessions/${room.sessionId}/workspace`,
      ).expect(200);
      expect(workspace.body.views.every((view: { imageUrl: string }) => view.imageUrl)).toBe(true);

      const locked = await post(room.customer, `/design/sessions/${room.sessionId}/lock`).expect(201);
      const product = await get(room.customer, `/design/locked-products/${locked.body.id}`).expect(200);
      expect(product.body.source).toBe('DESIGNER');
      expect(product.body.views).toHaveLength(3);
      expect((await fetch(product.body.views[0].imageUrl)).status).toBe(200);
    });
  });
});
