import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { Product } from './catalog.port.js';

describe('catalog', () => {
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

  it('lists exactly the 3 shirt types, each with options to choose from', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/products')
      .set(...auth)
      .expect(200);
    const products: Product[] = res.body;
    expect(products.map((product) => product.shirtType).sort()).toEqual([
      'FOOTBALL',
      'PRINTED',
      'VOLLEYBALL',
    ]);
    for (const product of products) {
      expect(product.colours.length).toBeGreaterThan(0);
      expect(product.materials.length).toBeGreaterThan(0);
      expect(product.sizes.length).toBeGreaterThan(0);
    }
  });

  it('returns one product, and 404 for an unknown one', async () => {
    const res = await request(app.getHttpServer())
      .get('/catalog/products/football-shirt')
      .set(...auth)
      .expect(200);
    expect(res.body.name).toBe('Áo đá bóng');
    await request(app.getHttpServer())
      .get('/catalog/products/hat')
      .set(...auth)
      .expect(404);
  });

  it('needs login', async () => {
    await request(app.getHttpServer()).get('/catalog/products').expect(401);
  });
});
