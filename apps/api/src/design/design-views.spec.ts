import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DAILY_IMAGE_LIMIT } from '../ai/image-jobs.service.js';
import { FakeImageProvider } from '../ai/fake-image.provider.js';
import {
  ImageProvider,
  ImageProviderError,
  ImageRequest,
} from '../ai/image-provider.js';
import { AppModule } from '../app.module.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';

class ScriptedProvider extends FakeImageProvider {
  calls: ImageRequest[] = [];
  failures: Error[] = [];

  override async generate(req: ImageRequest) {
    this.calls.push(req);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return super.generate(req);
  }
}

describe('choosing the main image', () => {
  const provider = new ScriptedProvider();
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: { id: string; token: string };
  let other: { id: string; token: string };
  const userIds: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;

  async function newCustomer() {
    const email = `${crypto.randomUUID()}@views.test`;
    const user = await prisma.user.create({ data: { email, name: 'Test', role: 'CUSTOMER' } });
    userIds.push(user.id);
    const res = await request(server()).post('/auth/dev-login').send({ email }).expect(200);
    return { id: user.id, token: res.body.token as string };
  }

  async function sessionWithImage(owner = customer) {
    const created = await request(server())
      .post('/design/sessions')
      .set(...bearer(owner.token))
      .send({
        productId: 'printed-shirt',
        colourId: 'white',
        materialId: 'cotton',
        size: 'M',
        quantity: 1,
      })
      .expect(201);
    const id = created.body.id as string;
    await request(server())
      .put(`/design/sessions/${id}/answers`)
      .set(...bearer(owner.token))
      .send({
        answers: {
          main_image: 'Con hổ',
          image_style: 'cartoon',
          print_placement: 'large-centre-chest',
          back_print: 'plain',
          occasion: 'personal',
          style: 'bold',
          has_text: 'no',
        },
      })
      .expect(200);
    await request(server())
      .post(`/design/sessions/${id}/answers/submit`)
      .set(...bearer(owner.token))
      .expect(200);
    const job = await request(server())
      .post(`/design/sessions/${id}/images`)
      .set(...bearer(owner.token))
      .expect(201);
    const done = await finished(job.body.id);
    return { id, versionId: done.versionId as string };
  }

  async function finished(jobId: string) {
    for (let i = 0; i < 300; i++) {
      const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status === 'DONE' || job.status === 'FAILED') return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Job did not finish');
  }

  async function state(sessionId: string, owner = customer) {
    const res = await request(server())
      .get(`/design/sessions/${sessionId}/workspace`)
      .set(...bearer(owner.token))
      .expect(200);
    return res.body;
  }

  async function viewsFinished(sessionId: string) {
    for (let i = 0; i < 300; i++) {
      const active = await prisma.aiJob.count({
        where: { sessionId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (!active) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('Views did not finish');
  }

  const view = (views: { type: string }[], type: string) =>
    views.find((candidate) => candidate.type === type) as Record<string, string>;

  const generate = (sessionId: string, viewId: string, owner = customer) =>
    request(server())
      .post(`/design/sessions/${sessionId}/views/${viewId}/generate`)
      .set(...bearer(owner.token));

  async function fillUsage(owner: { id: string }, sessionId: string, count: number) {
    await prisma.aiJob.createMany({
      data: Array.from({ length: count }, () => ({
        sessionId,
        customerId: owner.id,
        kind: 'CREATE' as const,
        status: 'DONE' as const,
        prompt: 'x',
        referenceFileIds: [],
      })),
    });
  }

  const choose = (sessionId: string, versionId: string, owner = customer) =>
    request(server())
      .post(`/design/sessions/${sessionId}/main-image`)
      .set(...bearer(owner.token))
      .send({ versionId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ImageProvider)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    customer = await newCustomer();
    other = await newCustomer();
  });

  afterAll(async () => {
    const session = { customerId: { in: userIds } };
    await prisma.lockedProduct.deleteMany({ where: { session } });
    await prisma.aiJob.deleteMany({ where: session });
    await prisma.productView.deleteMany({ where: { session } });
    await prisma.designVersion.deleteMany({ where: { session } });
    await prisma.designSession.deleteMany({ where: session });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('makes the chosen image the approved front view', async () => {
    const { id, versionId } = await sessionWithImage();
    const res = await choose(id, versionId).expect(201);
    expect(res.body.find((view: { type: string }) => view.type === 'FRONT')).toMatchObject({
      versionId,
      status: 'APPROVED',
    });
    await viewsFinished(id);
    const session = await prisma.designSession.findUniqueOrThrow({ where: { id } });
    expect(session.status).toBe('VIEWS');
  });

  it('can be done only once, and ends free editing', async () => {
    const { id, versionId } = await sessionWithImage();
    await choose(id, versionId).expect(201);
    await choose(id, versionId).expect(409);
    await request(server())
      .post(`/design/sessions/${id}/edits`)
      .set(...bearer(customer.token))
      .send({ versionId, request: 'đổi màu' })
      .expect(409);
  });

  it('allows only one winner when two requests race', async () => {
    const { id, versionId } = await sessionWithImage();
    const results = await Promise.all([choose(id, versionId), choose(id, versionId)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await prisma.productView.count({ where: { sessionId: id } })).toBe(3);
    expect(await prisma.aiJob.count({ where: { sessionId: id, kind: 'VIEW' } })).toBe(2);
    await viewsFinished(id);
  });

  it('refuses while an image is being created', async () => {
    const { id, versionId } = await sessionWithImage();
    const job = await prisma.aiJob.create({
      data: {
        sessionId: id,
        customerId: customer.id,
        kind: 'EDIT',
        status: 'RUNNING',
        prompt: 'x',
        referenceFileIds: [],
      },
    });
    await choose(id, versionId).expect(409);
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: 'DONE' } });
    await choose(id, versionId).expect(201);
  });

  it('refuses a version from elsewhere and other people', async () => {
    const first = await sessionWithImage();
    const second = await sessionWithImage();
    await choose(first.id, second.versionId).expect(404);
    await choose(first.id, first.versionId, other).expect(403);
    await request(server())
      .post(`/design/sessions/${first.id}/main-image`)
      .send({ versionId: first.versionId })
      .expect(401);
  });

  describe('generating the back and close-up', () => {
    it('starts both from the main image, and they stay out of the edit history', async () => {
      const { id, versionId } = await sessionWithImage();
      provider.calls = [];
      await choose(id, versionId).expect(201);
      await viewsFinished(id);

      const { views, versions } = await state(id);
      expect(views.map((item: { type: string }) => item.type).sort()).toEqual([
        'BACK',
        'CLOSE_UP',
        'FRONT',
      ]);
      expect(view(views, 'BACK')).toMatchObject({ status: 'READY', jobStatus: 'DONE' });
      expect(view(views, 'CLOSE_UP')).toMatchObject({ status: 'READY', jobStatus: 'DONE' });
      expect((await fetch(view(views, 'BACK').imageUrl)).status).toBe(200);
      expect(versions).toHaveLength(1);

      const back = await prisma.designVersion.findUniqueOrThrow({
        where: { id: view(views, 'BACK').versionId },
      });
      expect(back.parentVersionId).toBe(versionId);

      const prompts = provider.calls.map((call) => call.prompt);
      expect(prompts.some((prompt) => prompt.includes('The back is plain'))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes('tight close-up'))).toBe(true);
      expect(provider.calls.every((call) => call.images.length === 1)).toBe(true);
    });

    it('counts both views against the limit', async () => {
      const owner = await newCustomer();
      const { id, versionId } = await sessionWithImage(owner);
      await choose(id, versionId, owner).expect(201);
      await viewsFinished(id);
      expect((await state(id, owner)).usage.used).toBe(3);
    });

    it('waits when only one credit is left, and continues once there is room', async () => {
      const owner = await newCustomer();
      const { id, versionId } = await sessionWithImage(owner);
      await fillUsage(owner, id, DAILY_IMAGE_LIMIT - 2);
      await choose(id, versionId, owner).expect(201);
      await viewsFinished(id);

      const { views, usage } = await state(id, owner);
      expect(usage.remaining).toBe(0);
      expect(view(views, 'BACK').status).toBe('READY');
      expect(view(views, 'CLOSE_UP')).toMatchObject({ status: 'PENDING', jobStatus: null });

      await generate(id, view(views, 'CLOSE_UP').id, owner).expect(429);
      await prisma.aiJob.deleteMany({ where: { sessionId: id, prompt: 'x' } });
      await generate(id, view(views, 'CLOSE_UP').id, owner).expect(201);
      await viewsFinished(id);
      expect(view((await state(id, owner)).views, 'CLOSE_UP').status).toBe('READY');
    });

    it('still accepts the main image when no credits are left', async () => {
      const owner = await newCustomer();
      const { id, versionId } = await sessionWithImage(owner);
      await fillUsage(owner, id, DAILY_IMAGE_LIMIT);
      await choose(id, versionId, owner).expect(201);
      const { views } = await state(id, owner);
      expect(view(views, 'FRONT').status).toBe('APPROVED');
      expect(view(views, 'BACK').status).toBe('PENDING');
    });

    it('reports a failed view without using a credit, and it can be started again', async () => {
      const owner = await newCustomer();
      const { id, versionId } = await sessionWithImage(owner);
      provider.failures = [new ImageProviderError('blocked', false)];
      await choose(id, versionId, owner).expect(201);
      await viewsFinished(id);

      const { views, usage } = await state(id, owner);
      const failed = views.find((item: { jobStatus: string }) => item.jobStatus === 'FAILED');
      expect(failed.status).toBe('PENDING');
      expect(usage.used).toBe(2);

      await generate(id, failed.id, owner).expect(201);
      await viewsFinished(id);
      expect(
        (await state(id, owner)).views.every(
          (item: { status: string }) => item.status !== 'PENDING',
        ),
      ).toBe(true);
    });

    it('refuses to start a view that has an image, is running, or is elsewhere', async () => {
      const owner = await newCustomer();
      const first = await sessionWithImage(owner);
      const second = await sessionWithImage(owner);
      await choose(first.id, first.versionId, owner).expect(201);
      await choose(second.id, second.versionId, owner).expect(201);
      await viewsFinished(first.id);
      await viewsFinished(second.id);
      const back = view((await state(first.id, owner)).views, 'BACK');
      await generate(first.id, back.id, owner).expect(409);
      await generate(second.id, back.id, owner).expect(404);
      await generate(first.id, back.id, other).expect(403);

      await prisma.productView.update({ where: { id: back.id }, data: { status: 'PENDING' } });
      const running = await prisma.aiJob.create({
        data: {
          sessionId: first.id,
          customerId: owner.id,
          viewId: back.id,
          kind: 'VIEW',
          status: 'RUNNING',
          prompt: 'x',
          referenceFileIds: [],
        },
      });
      await generate(first.id, back.id, owner).expect(409);
      await prisma.aiJob.update({ where: { id: running.id }, data: { status: 'DONE' } });
    });
  });

  describe('approving and locking', () => {
    const post = (path: string, owner: { token: string }, body?: object) =>
      request(server()).post(path).set(...bearer(owner.token)).send(body);

    /** A session with all views generated, for a customer of its own. */
    async function readyViews() {
      const owner = await newCustomer();
      const { id, versionId } = await sessionWithImage(owner);
      await choose(id, versionId, owner).expect(201);
      await viewsFinished(id);
      const { views } = await state(id, owner);
      return { owner, id, back: view(views, 'BACK'), closeUp: view(views, 'CLOSE_UP') };
    }

    const approve = (id: string, viewId: string, owner: { token: string }) =>
      post(`/design/sessions/${id}/views/${viewId}/approve`, owner);
    const regenerate = (id: string, viewId: string, owner: { token: string }) =>
      post(`/design/sessions/${id}/views/${viewId}/regenerate`, owner);
    const lock = (id: string, owner: { token: string }) =>
      post(`/design/sessions/${id}/lock`, owner);

    it('regenerates one view alone, and leaves approved views as they were', async () => {
      const { owner, id, back, closeUp } = await readyViews();
      await approve(id, back.id, owner).expect(200);

      await regenerate(id, closeUp.id, owner).expect(201);
      await viewsFinished(id);

      const { views, usage } = await state(id, owner);
      expect(view(views, 'CLOSE_UP').versionId).not.toBe(closeUp.versionId);
      expect(view(views, 'CLOSE_UP').status).toBe('READY');
      expect(view(views, 'BACK')).toMatchObject({ versionId: back.versionId, status: 'APPROVED' });
      expect(usage.used).toBe(4);
    });

    it('will not regenerate an approved view or the front', async () => {
      const { owner, id, back } = await readyViews();
      await approve(id, back.id, owner).expect(200);
      await regenerate(id, back.id, owner).expect(409);
      const front = view((await state(id, owner)).views, 'FRONT');
      await regenerate(id, front.id, owner).expect(409);
    });

    it('will not approve a view with no image or one being remade', async () => {
      const { owner, id, back } = await readyViews();
      await prisma.aiJob.create({
        data: {
          sessionId: id,
          customerId: owner.id,
          viewId: back.id,
          kind: 'VIEW',
          status: 'RUNNING',
          prompt: 'x',
          referenceFileIds: [],
        },
      });
      await approve(id, back.id, owner).expect(409);
      await prisma.aiJob.updateMany({
        where: { viewId: back.id, status: 'RUNNING' },
        data: { status: 'DONE' },
      });
      await prisma.productView.update({ where: { id: back.id }, data: { status: 'PENDING' } });
      await approve(id, back.id, owner).expect(409);
    });

    it('adds at most 2 extra views, each counted, with the typed description', async () => {
      const { owner, id } = await readyViews();
      provider.calls = [];
      const path = `/design/sessions/${id}/views`;
      await post(path, owner, { description: 'cận tay áo' }).expect(201);
      await viewsFinished(id);
      await post(path, owner, { description: 'góc nghiêng' }).expect(201);
      await viewsFinished(id);
      await post(path, owner, { description: 'thêm nữa' }).expect(409);
      await post(path, owner, { description: '   ' }).expect(400);

      const { views, usage } = await state(id, owner);
      expect(views.filter((item: { type: string }) => item.type === 'EXTRA')).toHaveLength(2);
      expect(usage.used).toBe(5);
      expect(provider.calls[0].prompt).toContain('[cận tay áo]');
      expect(provider.calls[0].images).toHaveLength(1);
    });

    it('gives the slot back when no credit is left for an extra view', async () => {
      const { owner, id } = await readyViews();
      await fillUsage(owner, id, DAILY_IMAGE_LIMIT);
      const path = `/design/sessions/${id}/views`;
      await post(path, owner, { description: 'cận tay áo' }).expect(429);
      const { views } = await state(id, owner);
      expect(views.some((item: { type: string }) => item.type === 'EXTRA')).toBe(false);
    });

    it('locks only with the 3 required views approved', async () => {
      const { owner, id, back, closeUp } = await readyViews();
      await lock(id, owner).expect(409);
      await approve(id, back.id, owner).expect(200);
      await lock(id, owner).expect(409);
      await approve(id, closeUp.id, owner).expect(200);
      await lock(id, owner).expect(201);
      expect((await state(id, owner)).status).toBe('LOCKED');
    });

    it('does not need extra views, and leaves unapproved ones out', async () => {
      const { owner, id, back, closeUp } = await readyViews();
      await post(`/design/sessions/${id}/views`, owner, { description: 'cận tay' }).expect(201);
      await viewsFinished(id);
      await approve(id, back.id, owner).expect(200);
      await approve(id, closeUp.id, owner).expect(200);

      const res = await lock(id, owner).expect(201);
      const product = await request(server())
        .get(`/design/locked-products/${res.body.id}`)
        .set(...bearer(owner.token))
        .expect(200);
      expect(product.body.views).toHaveLength(3);
    });

    it('refuses to lock while an image is being made', async () => {
      const { owner, id, back, closeUp } = await readyViews();
      await approve(id, back.id, owner).expect(200);
      await approve(id, closeUp.id, owner).expect(200);
      const job = await prisma.aiJob.create({
        data: {
          sessionId: id,
          customerId: owner.id,
          kind: 'VIEW',
          status: 'QUEUED',
          prompt: 'x',
          referenceFileIds: [],
        },
      });
      await lock(id, owner).expect(409);
      await prisma.aiJob.update({ where: { id: job.id }, data: { status: 'DONE' } });
    });

    it('freezes everything after locking, and one of two parallel locks wins', async () => {
      const { owner, id, back, closeUp } = await readyViews();
      await approve(id, back.id, owner).expect(200);
      await approve(id, closeUp.id, owner).expect(200);
      const results = await Promise.all([lock(id, owner), lock(id, owner)]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);

      await regenerate(id, back.id, owner).expect(409);
      await post(`/design/sessions/${id}/views`, owner, { description: 'x' }).expect(409);
      await approve(id, back.id, owner).expect(409);
      await lock(id, owner).expect(409);
    });

    it('hands over images, specs, answers and uploads to the owner and managers', async () => {
      const owner = await newCustomer();
      const logo = await app.get(FilesPort).saveImage(owner.id, {
        mimeType: 'image/png',
        data: (await new FakeImageProvider().generate({ prompt: 'logo', images: [] })).image.data,
      });
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
            has_logo: 'yes',
            logo_position: 'left-chest',
            logo_upload: [logo],
            occasion: 'team',
            style: 'bold',
            has_text: 'no',
          },
        })
        .expect(200);
      await post(`/design/sessions/${id}/answers/submit`, owner).expect(200);
      const job = await post(`/design/sessions/${id}/images`, owner).expect(201);
      const main = await finished(job.body.id);
      await choose(id, main.versionId!, owner).expect(201);
      await viewsFinished(id);
      const { views } = await state(id, owner);
      await approve(id, view(views, 'BACK').id, owner).expect(200);
      await approve(id, view(views, 'CLOSE_UP').id, owner).expect(200);
      const locked = await lock(id, owner).expect(201);

      const manager = await request(server())
        .post('/auth/dev-login')
        .send({ email: 'quanli@example.test' })
        .expect(200);
      const res = await request(server())
        .get(`/design/locked-products/${locked.body.id}`)
        .set(...bearer(manager.body.token))
        .expect(200);

      expect(res.body.source).toBe('AI');
      expect(res.body.views.map((item: { type: string }) => item.type)).toEqual([
        'FRONT',
        'BACK',
        'CLOSE_UP',
      ]);
      expect((await fetch(res.body.views[1].imageUrl)).status).toBe(200);
      expect(res.body.product.product.shirtType).toBe('FOOTBALL');
      expect(res.body.answers.team_name).toBe('FC Sài Gòn');
      expect(res.body.uploads).toHaveLength(1);
      expect(res.body.uploads[0].fileId).toBe(logo);
      expect((await fetch(res.body.uploads[0].url)).status).toBe(200);

      await request(server())
        .get(`/design/locked-products/${locked.body.id}`)
        .set(...bearer(other.token))
        .expect(403);
      await request(server())
        .get('/design/locked-products/00000000-0000-4000-8000-000000000000')
        .set(...bearer(owner.token))
        .expect(404);
    });
  });
});
