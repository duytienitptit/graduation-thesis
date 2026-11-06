import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
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
import { FakeImageProvider } from './fake-image.provider.js';
import { DAILY_IMAGE_LIMIT, ImageJobsService } from './image-jobs.service.js';
import {
  ImageProvider,
  ImageProviderError,
  ImageRequest,
  ImageResult,
} from './image-provider.js';
import { IMAGE_JOB_EVENT } from './image.processor.js';

// Runs against the real PostgreSQL, Redis and MinIO; only the image API is scripted.
class ScriptedProvider extends ImageProvider {
  calls: ImageRequest[] = [];
  failures: Error[] = [];
  gate: Promise<void> = Promise.resolve();
  private fake = new FakeImageProvider();

  async generate(req: ImageRequest): Promise<ImageResult> {
    this.calls.push(req);
    await this.gate;
    const failure = this.failures.shift();
    if (failure) throw failure;
    return this.fake.generate(req);
  }
}

const RETRYABLE = () => new ImageProviderError('Image API returned 503', true);
const FINAL = () => new ImageProviderError('Image API returned no image (SAFETY)', false);

describe('AI image flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let customer: { id: string; token: string };
  let other: { id: string; token: string };
  let designerToken: string;
  let managerToken: string;
  let logoId: string;
  const provider = new ScriptedProvider();
  const clock = { now: () => new Date() };
  const userIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;

  async function login(email: string) {
    const res = await request(server()).post('/auth/dev-login').send({ email }).expect(200);
    return res.body.token as string;
  }

  async function newCustomer() {
    const email = `${crypto.randomUUID()}@ai.test`;
    const user = await prisma.user.create({
      data: { email, name: 'Test', role: 'CUSTOMER' },
    });
    userIds.push(user.id);
    return { id: user.id, token: await login(email) };
  }

  async function answeredSession(owner = customer, logo?: string) {
    const created = await request(server())
      .post('/design/sessions')
      .set(...bearer(owner.token))
      .send({
        productId: 'football-shirt',
        colourId: 'red',
        materialId: 'mesh',
        size: 'L',
        quantity: 11,
      })
      .expect(201);
    const id = created.body.id as string;
    await request(server())
      .put(`/design/sessions/${id}/answers`)
      .set(...bearer(owner.token))
      .send({
        answers: {
          team_name: 'FC Sài Gòn',
          pattern: 'plain',
          collar: 'polo',
          has_logo: logo ? 'yes' : 'no',
          ...(logo ? { logo_position: 'left-chest', logo_upload: [logo] } : {}),
          occasion: 'team',
          style: 'bold',
          has_text: 'no',
        },
      })
      .expect(200);
    await request(server())
      .post(`/design/sessions/${id}/answers/submit`)
      .set(...bearer(owner.token))
      .expect(200);
    return id;
  }

  const create = (sessionId: string, owner = customer) =>
    request(server()).post(`/design/sessions/${sessionId}/images`).set(...bearer(owner.token));

  const edit = (sessionId: string, body: object, owner = customer) =>
    request(server())
      .post(`/design/sessions/${sessionId}/edits`)
      .set(...bearer(owner.token))
      .send(body);

  const workspace = async (sessionId: string, token = customer.token) =>
    (
      await request(server())
        .get(`/design/sessions/${sessionId}/workspace`)
        .set(...bearer(token))
        .expect(200)
    ).body;

  async function finished(jobId: string) {
    for (let i = 0; i < 300; i++) {
      const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status === 'DONE' || job.status === 'FAILED') return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Job did not finish');
  }

  async function firstImage(sessionId: string) {
    const res = await create(sessionId).expect(201);
    const job = await finished(res.body.id);
    expect(job.status).toBe('DONE');
    return job;
  }

  /** Fills today's usage directly, so limit tests need not run real jobs. */
  async function useUp(owner: { id: string }, sessionId: string, count: number, status = 'DONE') {
    await prisma.aiJob.createMany({
      data: Array.from({ length: count }, () => ({
        sessionId,
        customerId: owner.id,
        kind: 'CREATE' as const,
        status: status as 'DONE' | 'FAILED',
        prompt: 'x',
        referenceFileIds: [],
      })),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ImageProvider)
      .useValue(provider)
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(server().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);

    customer = await newCustomer();
    other = await newCustomer();
    designerToken = await login('designer@example.test');
    managerToken = await login('quanli@example.test');

    logoId = await app.get(FilesPort).saveImage(customer.id, {
      mimeType: 'image/png',
      data: (await new FakeImageProvider().generate({ prompt: 'logo', images: [] })).image.data,
    });
  });

  afterEach(() => {
    provider.calls = [];
    provider.failures = [];
    provider.gate = Promise.resolve();
    clock.now = () => new Date();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const where = { customerId: { in: userIds } };
    await prisma.aiJob.deleteMany({ where });
    await prisma.designVersion.deleteMany({ where: { session: where } });
    await prisma.designSession.deleteMany({ where });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('creates the first image end to end, and records the job', async () => {
    const sessionId = await answeredSession(customer, logoId);
    const res = await create(sessionId).expect(201);
    expect(res.body.status).toBe('QUEUED');

    const job = await finished(res.body.id);
    expect(job).toMatchObject({ status: 'DONE', model: 'fake', attempts: 1, kind: 'CREATE' });
    expect(job.durationMs).toBeGreaterThanOrEqual(0);
    expect(job.finishedAt).not.toBeNull();
    expect(Number(job.costUsd)).toBe(0);

    expect(provider.calls[0].prompt).toContain('"FC Sài Gòn"');
    expect(provider.calls[0].images).toHaveLength(1);

    const { versions, usage } = await workspace(sessionId);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ source: 'AI', parentVersionId: null });
    const image = await fetch(versions[0].imageUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(usage.limit).toBe(DAILY_IMAGE_LIMIT);
  });

  it('retries a passing error and then succeeds', async () => {
    provider.failures = [RETRYABLE(), RETRYABLE()];
    const sessionId = await answeredSession();
    const res = await create(sessionId).expect(201);
    const job = await finished(res.body.id);
    expect(job).toMatchObject({ status: 'DONE', attempts: 3, error: null });
  });

  it('reports failure after the retries, uses no credit, and can be tried again', async () => {
    const owner = await newCustomer();
    provider.failures = [RETRYABLE(), RETRYABLE(), RETRYABLE()];
    const sessionId = await answeredSession(owner);
    const res = await create(sessionId, owner).expect(201);

    const job = await finished(res.body.id);
    expect(job).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(job.error).toContain('503');

    const state = await workspace(sessionId, owner.token);
    expect(state.latestJob.status).toBe('FAILED');
    expect(state.versions).toEqual([]);
    expect(state.usage.used).toBe(0);

    const again = await create(sessionId, owner).expect(201);
    expect((await finished(again.body.id)).status).toBe('DONE');
  });

  it('does not retry an error that will not pass', async () => {
    provider.failures = [FINAL(), RETRYABLE()];
    const sessionId = await answeredSession();
    const res = await create(sessionId).expect(201);
    const job = await finished(res.body.id);
    expect(job).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(job.error).toContain('SAFETY');
  });

  it('marks the job failed and uses no credit when the queue is down', async () => {
    const owner = await newCustomer();
    const sessionId = await answeredSession(owner);
    const jobs = app.get(ImageJobsService) as unknown as {
      queue: { add: (...args: unknown[]) => Promise<unknown> };
    };
    jest.spyOn(jobs.queue, 'add').mockRejectedValueOnce(new Error('redis down'));
    await create(sessionId, owner).expect(503);
    expect((await workspace(sessionId, owner.token)).usage.used).toBe(0);
  });

  it('needs submitted answers', async () => {
    const created = await request(server())
      .post('/design/sessions')
      .set(...bearer(customer.token))
      .send({
        productId: 'printed-shirt',
        colourId: 'white',
        materialId: 'cotton',
        size: 'M',
        quantity: 1,
      })
      .expect(201);
    await create(created.body.id).expect(409);
  });

  it('allows one job at a time per session, and only one first image', async () => {
    let open = () => {};
    provider.gate = new Promise((resolve) => {
      open = resolve;
    });
    const sessionId = await answeredSession();
    const res = await create(sessionId).expect(201);
    await create(sessionId).expect(409);
    open();
    await finished(res.body.id);
    await create(sessionId).expect(409);
  });

  it('keeps other people out', async () => {
    const sessionId = await answeredSession();
    await create(sessionId, other).expect(403);
    await request(server())
      .post(`/design/sessions/${sessionId}/images`)
      .set(...bearer(designerToken))
      .expect(403);
    await request(server()).post(`/design/sessions/${sessionId}/images`).expect(401);
    await request(server())
      .get(`/design/sessions/${sessionId}/workspace`)
      .set(...bearer(designerToken))
      .expect(403);
    await workspace(sessionId, managerToken);
  });

  describe('daily limit', () => {
    it('stops at 20 images, and failed jobs do not count', async () => {
      const owner = await newCustomer();
      const sessionId = await answeredSession(owner);
      await useUp(owner, sessionId, DAILY_IMAGE_LIMIT - 1);
      await useUp(owner, sessionId, 5, 'FAILED');

      const allowed = await create(sessionId, owner).expect(201);
      await finished(allowed.body.id);

      const blocked = await answeredSession(owner);
      const res = await create(blocked, owner).expect(429);
      expect(res.body.code).toBe('daily-limit');
      expect(new Date(res.body.resetsAt).getTime()).toBeGreaterThan(Date.now());
      expect((await workspace(blocked, owner.token)).usage.remaining).toBe(0);
    });

    it('resets at midnight Vietnam time', async () => {
      const owner = await newCustomer();
      const sessionId = await answeredSession(owner);
      const lastMinute = new Date('2026-11-06T16:59:00Z');
      clock.now = () => lastMinute;
      await prisma.aiJob.createMany({
        data: Array.from({ length: DAILY_IMAGE_LIMIT }, () => ({
          sessionId,
          customerId: owner.id,
          kind: 'CREATE' as const,
          status: 'DONE' as const,
          prompt: 'x',
          referenceFileIds: [],
          createdAt: lastMinute,
        })),
      });
      await create(sessionId, owner).expect(429);

      clock.now = () => new Date('2026-11-06T17:00:00Z');
      const res = await create(sessionId, owner).expect(201);
      await finished(res.body.id);
    });

    it('cannot be passed by parallel requests', async () => {
      const owner = await newCustomer();
      const sessions = await Promise.all(
        Array.from({ length: 4 }, () => answeredSession(owner)),
      );
      await useUp(owner, sessions[0], DAILY_IMAGE_LIMIT - 1);

      const results = await Promise.all(sessions.map((id) => create(id, owner)));
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 429, 429, 429]);
      const accepted = results.find((res) => res.status === 201);
      await finished(accepted!.body.id);
    });
  });

  describe('edits', () => {
    it('makes a new version from the chosen one and keeps the old one', async () => {
      const sessionId = await answeredSession(customer, logoId);
      const first = await firstImage(sessionId);
      provider.calls = [];

      const res = await edit(sessionId, {
        versionId: first.versionId,
        request: 'đổi cổ áo sang cổ tròn',
      }).expect(201);
      const job = await finished(res.body.id);
      expect(job).toMatchObject({ status: 'DONE', kind: 'EDIT' });

      expect(provider.calls[0].prompt).toContain('[đổi cổ áo sang cổ tròn]');
      expect(provider.calls[0].images).toHaveLength(2);

      const { versions } = await workspace(sessionId);
      expect(versions.map((version: { id: string }) => version.id)).toEqual([
        first.versionId,
        job.versionId,
      ]);
      expect(versions[1]).toMatchObject({
        parentVersionId: first.versionId,
        editRequest: 'đổi cổ áo sang cổ tròn',
      });
      expect((await fetch(versions[0].imageUrl)).status).toBe(200);
    });

    it('can start from an older version', async () => {
      const sessionId = await answeredSession();
      const first = await firstImage(sessionId);
      const second = await finished(
        (await edit(sessionId, { versionId: first.versionId, request: 'a' }).expect(201)).body.id,
      );
      const third = await finished(
        (await edit(sessionId, { versionId: first.versionId, request: 'b' }).expect(201)).body.id,
      );
      expect(second.parentVersionId).toBe(first.versionId);
      expect(third.parentVersionId).toBe(first.versionId);
    });

    it('counts against the limit', async () => {
      const sessionId = await answeredSession(other);
      const before = (await workspace(sessionId, other.token)).usage.used;
      const res = await create(sessionId, other).expect(201);
      const first = await finished(res.body.id);
      const edited = await edit(sessionId, { versionId: first.versionId, request: 'x' }, other);
      await finished(edited.body.id);
      expect((await workspace(sessionId, other.token)).usage.used).toBe(before + 2);
    });

    it('refuses an empty or overlong request and a version from elsewhere', async () => {
      const sessionId = await answeredSession();
      const first = await firstImage(sessionId);
      const elsewhere = await answeredSession();
      await edit(sessionId, { versionId: first.versionId, request: '   ' }).expect(400);
      await edit(sessionId, { versionId: first.versionId, request: 'x'.repeat(1001) }).expect(400);
      await edit(elsewhere, { versionId: first.versionId, request: 'x' }).expect(404);
      await edit(sessionId, { versionId: first.versionId, request: 'x' }, other).expect(403);
    });
  });

  it('tells the customer live, and nobody else', async () => {
    const sessionId = await answeredSession();
    const socket = io(url, { auth: { token: customer.token }, transports: ['websocket'] });
    const stranger = io(url, { auth: { token: other.token }, transports: ['websocket'] });
    try {
      await Promise.all(
        [socket, stranger].map(
          (client) => new Promise<void>((resolve) => client.once('connect', () => resolve())),
        ),
      );
      const seen: string[] = [];
      const leaked: unknown[] = [];
      stranger.on(IMAGE_JOB_EVENT, (event) => leaked.push(event));
      const done = new Promise<void>((resolve) => {
        socket.on(IMAGE_JOB_EVENT, (event: { sessionId: string; status: string }) => {
          expect(event.sessionId).toBe(sessionId);
          seen.push(event.status);
          if (event.status === 'DONE') resolve();
        });
      });
      await create(sessionId).expect(201);
      await done;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen).toEqual(['RUNNING', 'DONE']);
      expect(leaked).toEqual([]);
    } finally {
      socket.disconnect();
      stranger.disconnect();
    }
  });
});
