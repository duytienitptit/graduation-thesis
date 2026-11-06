import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cleanAnswers, MAX_TEXT_LENGTH, missingRequired } from './answers.js';
import { QUESTION_SETS } from './question-sets.js';

const FOOTBALL = QUESTION_SETS.FOOTBALL;

const COMPLETE_FOOTBALL = {
  team_name: 'FC Sài Gòn',
  pattern: 'plain',
  collar: 'polo',
  has_logo: 'no',
  occasion: 'team',
  style: 'bold',
  has_text: 'no',
};

describe('cleanAnswers', () => {
  it('keeps valid answers and trims text', () => {
    const { answers, errors } = cleanAnswers(FOOTBALL, { team_name: '  FC Sài Gòn ', collar: 'polo' });
    expect(errors).toEqual([]);
    expect(answers).toEqual({ team_name: 'FC Sài Gòn', collar: 'polo' });
  });

  it('reports unknown questions, invalid choices and overlong text', () => {
    const { errors } = cleanAnswers(FOOTBALL, {
      shoe_size: '42',
      collar: 'turtleneck',
      team_name: 'x'.repeat(MAX_TEXT_LENGTH + 1),
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        { questionId: 'shoe_size', code: 'unknown' },
        { questionId: 'collar', code: 'invalid' },
        { questionId: 'team_name', code: 'too-long' },
      ]),
    );
  });

  it('reports too many files', () => {
    const { errors } = cleanAnswers(FOOTBALL, { has_logo: 'yes', logo_upload: ['a', 'b'] });
    expect(errors).toEqual([{ questionId: 'logo_upload', code: 'too-many-files' }]);
  });

  it('drops empty answers and answers to hidden questions', () => {
    const { answers, errors } = cleanAnswers(FOOTBALL, {
      notes: '   ',
      has_text: 'no',
      text_content: 'left over from before',
    });
    expect(errors).toEqual([]);
    expect(answers).toEqual({ has_text: 'no' });
  });
});

describe('missingRequired', () => {
  it('passes a complete set', () => {
    expect(missingRequired(FOOTBALL, COMPLETE_FOOTBALL)).toEqual([]);
  });

  it('requires a follow-up only once it is visible', () => {
    const answers = { ...COMPLETE_FOOTBALL, has_text: 'yes' };
    expect(missingRequired(FOOTBALL, answers)).toEqual([
      { questionId: 'text_content', code: 'required' },
    ]);
  });

  it('does not require optional questions', () => {
    const missing = missingRequired(FOOTBALL, {}).map((error) => error.questionId);
    expect(missing).toContain('team_name');
    expect(missing).not.toContain('sponsor');
    expect(missing).not.toContain('logo_upload');
  });
});

describe('answer routes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: string;
  let manager: string;
  let customerId: string;
  let designerId: string;
  const sessions: string[] = [];
  const files: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;
  const login = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body;

  async function newSession() {
    const res = await request(server())
      .post('/design/sessions')
      .set(...bearer(customer))
      .send({
        productId: 'football-shirt',
        colourId: 'red',
        materialId: 'mesh',
        size: 'L',
        quantity: 12,
      })
      .expect(201);
    sessions.push(res.body.id);
    return res.body.id as string;
  }

  const save = (id: string, answers: object, token = customer) =>
    request(server())
      .put(`/design/sessions/${id}/answers`)
      .set(...bearer(token))
      .send({ answers });

  const submit = (id: string) =>
    request(server())
      .post(`/design/sessions/${id}/answers/submit`)
      .set(...bearer(customer));

  async function file(ownerId: string, status: 'READY' | 'PENDING') {
    const id = crypto.randomUUID();
    await prisma.fileObject.create({
      data: {
        id,
        ownerId,
        status,
        storageKey: `test/${id}.png`,
        mimeType: 'image/png',
        size: 1,
        purpose: 'REFERENCE',
      },
    });
    files.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const session = await login('khach@example.test');
    customer = session.token;
    customerId = session.user.id;
    manager = (await login('quanli@example.test')).token;
    designerId = (await login('designer@example.test')).user.id;
  });

  afterAll(async () => {
    await prisma.designSession.deleteMany({ where: { id: { in: sessions } } });
    await prisma.fileObject.deleteMany({ where: { id: { in: files } } });
    await app.close();
  });

  it('saves a partial draft, then replaces it', async () => {
    const id = await newSession();
    await save(id, { team_name: 'FC A' }).expect(200);
    const res = await save(id, { team_name: 'FC B', collar: 'polo' }).expect(200);
    expect(res.body.answers).toEqual({ team_name: 'FC B', collar: 'polo' });
    expect(res.body.status).toBe('ANSWERING');
  });

  it('names the failing questions', async () => {
    const id = await newSession();
    const res = await save(id, { collar: 'turtleneck' }).expect(400);
    expect(res.body.errors).toEqual([{ questionId: 'collar', code: 'invalid' }]);
  });

  it('refuses to submit until required answers are there', async () => {
    const id = await newSession();
    await save(id, { team_name: 'FC A' }).expect(200);
    const res = await submit(id).expect(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([{ questionId: 'collar', code: 'required' }]),
    );
  });

  it('submits complete answers, and they cannot change afterwards', async () => {
    const id = await newSession();
    await save(id, COMPLETE_FOOTBALL).expect(200);
    const res = await submit(id).expect(200);
    expect(res.body.status).toBe('ANSWERED');
    await save(id, COMPLETE_FOOTBALL).expect(409);
    await submit(id).expect(409);
  });

  it('attaches an image the customer uploaded', async () => {
    const id = await newSession();
    const logo = await file(customerId, 'READY');
    const res = await save(id, { has_logo: 'yes', logo_upload: [logo] }).expect(200);
    expect(res.body.answers.logo_upload).toEqual([logo]);
  });

  it("refuses another person's image and an unfinished upload", async () => {
    const id = await newSession();
    const theirs = await file(designerId, 'READY');
    const unfinished = await file(customerId, 'PENDING');
    await save(id, { has_logo: 'yes', logo_upload: [theirs] }).expect(400);
    await save(id, { has_logo: 'yes', logo_upload: [unfinished] }).expect(400);
  });

  it('lets only the owning customer save', async () => {
    const id = await newSession();
    await save(id, {}, manager).expect(403);
    await request(server())
      .put(`/design/sessions/${id}/answers`)
      .send({ answers: {} })
      .expect(401);
  });

  it('refuses a body with no answers object', async () => {
    const id = await newSession();
    await request(server())
      .put(`/design/sessions/${id}/answers`)
      .set(...bearer(customer))
      .send({ answers: 'nope' })
      .expect(400);
  });
});
