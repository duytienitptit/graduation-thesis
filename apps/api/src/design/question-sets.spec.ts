import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { Question, QuestionSet } from './question-set.types.js';
import { QUESTION_SETS } from './question-sets.js';

const allQuestions = (set: QuestionSet) => set.sections.flatMap((section) => section.questions);
const ids = (set: QuestionSet) => allQuestions(set).map((question) => question.id);

describe.each(Object.entries(QUESTION_SETS))('%s question set', (_, set) => {
  it('has unique question ids', () => {
    expect(new Set(ids(set)).size).toBe(ids(set).length);
  });

  it('gives every choice question at least 2 options, with unique values', () => {
    for (const question of allQuestions(set)) {
      if (question.type !== 'choice') continue;
      const values = question.options.map((option) => option.value);
      expect(values.length).toBeGreaterThanOrEqual(2);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('only depends on an earlier choice question and a value it really has', () => {
    const seen: Question[] = [];
    for (const question of allQuestions(set)) {
      if (question.visibleWhen) {
        const { questionId, equals } = question.visibleWhen;
        const parent = seen.find((candidate) => candidate.id === questionId);
        expect(parent?.type).toBe('choice');
        if (parent?.type === 'choice') {
          expect(parent.options.map((option) => option.value)).toContain(equals);
        }
      }
      seen.push(question);
    }
  });

  it('never asks what the product step already chose', () => {
    expect(ids(set)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(material|shirt_colour|size|quantity)$/)]),
    );
  });

  it('includes the common questions', () => {
    expect(ids(set)).toEqual(
      expect.arrayContaining(['occasion', 'style', 'colours_include', 'colours_avoid']),
    );
    expect(ids(set)).toEqual(
      expect.arrayContaining(['has_text', 'text_content', 'unwanted', 'notes']),
    );
  });
});

describe('question sets per shirt type', () => {
  it('asks what the design lists for each type', () => {
    expect(ids(QUESTION_SETS.PRINTED)).toEqual(
      expect.arrayContaining([
        'main_image',
        'image_style',
        'print_placement',
        'back_print',
        'reference_upload',
      ]),
    );
    expect(ids(QUESTION_SETS.FOOTBALL)).toEqual(
      expect.arrayContaining([
        'team_name',
        'pattern',
        'collar',
        'has_logo',
        'logo_upload',
        'sample_name',
        'sample_number',
        'sponsor',
      ]),
    );
    expect(ids(QUESTION_SETS.VOLLEYBALL)).toEqual(
      expect.arrayContaining([
        'team_name',
        'sleeve',
        'pattern',
        'has_logo',
        'logo_upload',
        'number_position',
        'sample_name',
        'sample_number',
        'libero',
      ]),
    );
  });
});

describe('GET /design/products/:productId/questions', () => {
  let app: INestApplication;
  let auth: [string, string];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const res = await request(app.getHttpServer())
      .post('/auth/dev-login')
      .send({ email: 'khach@example.test' })
      .expect(200);
    auth = ['Authorization', `Bearer ${res.body.token}`];
  });

  afterAll(() => app.close());

  it('returns the set that matches the product type', async () => {
    const res = await request(app.getHttpServer())
      .get('/design/products/volleyball-shirt/questions')
      .set(...auth)
      .expect(200);
    expect(ids(res.body)).toContain('libero');
    expect(ids(res.body)).not.toContain('collar');
  });

  it('returns 404 for an unknown product and 401 without login', async () => {
    await request(app.getHttpServer())
      .get('/design/products/hat/questions')
      .set(...auth)
      .expect(404);
    await request(app.getHttpServer()).get('/design/products/football-shirt/questions').expect(401);
  });
});
