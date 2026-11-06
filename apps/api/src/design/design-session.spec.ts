import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { CatalogPort, Product } from '../integrations/catalog/catalog.port.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SPECS = {
  productId: 'football-shirt',
  colourId: 'red',
  materialId: 'mesh',
  size: 'L',
  quantity: 12,
};

describe('design sessions', () => {
  let app: INestApplication;
  let customer: string;
  let designer: string;
  let manager: string;
  const created: string[] = [];

  // A mutable catalog, to prove a session keeps its copy after the catalog changes.
  const product: Product = {
    id: 'football-shirt',
    name: 'Áo đá bóng',
    shirtType: 'FOOTBALL',
    colours: [{ id: 'red', name: 'Đỏ', hex: '#dc2626' }],
    materials: [{ id: 'mesh', name: 'Thun mè thể thao' }],
    sizes: ['L'],
  };

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;
  const login = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body.token;

  async function createSession(body: object = SPECS) {
    const res = await request(server())
      .post('/design/sessions')
      .set(...bearer(customer))
      .send(body)
      .expect(201);
    created.push(res.body.id);
    return res.body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CatalogPort)
      .useValue({
        listProducts: async () => [product],
        getProduct: async (id: string) => (id === product.id ? product : null),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    customer = await login('khach@example.test');
    designer = await login('designer@example.test');
    manager = await login('quanli@example.test');
  });

  afterAll(async () => {
    await app.get(PrismaService).designSession.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  it('creates a session with a snapshot of the chosen specs', async () => {
    const session = await createSession();
    expect(session.status).toBe('ANSWERING');
    expect(session.answers).toEqual({});
    expect(session.specSnapshot).toEqual({
      product: { id: 'football-shirt', name: 'Áo đá bóng', shirtType: 'FOOTBALL' },
      colour: { id: 'red', name: 'Đỏ', hex: '#dc2626' },
      material: { id: 'mesh', name: 'Thun mè thể thao' },
      size: 'L',
      quantity: 12,
    });
  });

  it('keeps the snapshot when the catalog changes later', async () => {
    const session = await createSession();
    const originalName = product.colours[0].name;
    product.colours[0].name = 'Đỏ đô';
    try {
      const res = await request(server())
        .get(`/design/sessions/${session.id}`)
        .set(...bearer(customer))
        .expect(200);
      expect(res.body.specSnapshot.colour.name).toBe(originalName);
    } finally {
      product.colours[0].name = originalName;
    }
  });

  it.each([
    ['product', { productId: 'hat' }],
    ['colour', { colourId: 'pink' }],
    ['material', { materialId: 'silk' }],
    ['size', { size: '9XL' }],
    ['quantity of zero', { quantity: 0 }],
    ['fractional quantity', { quantity: 1.5 }],
  ])('refuses an invalid %s', async (_, change) => {
    await request(server())
      .post('/design/sessions')
      .set(...bearer(customer))
      .send({ ...SPECS, ...change })
      .expect(400);
  });

  it('lets only customers create sessions', async () => {
    await request(server())
      .post('/design/sessions')
      .set(...bearer(designer))
      .send(SPECS)
      .expect(403);
    await request(server()).post('/design/sessions').send(SPECS).expect(401);
  });

  it('lists only your own sessions, newest first', async () => {
    const first = await createSession();
    const second = await createSession();
    const res = await request(server())
      .get('/design/sessions')
      .set(...bearer(customer))
      .expect(200);
    const listed: string[] = res.body.map((session: { id: string }) => session.id);
    expect(listed.indexOf(second.id)).toBeLessThan(listed.indexOf(first.id));
  });

  it('lets the owner and managers read a session, but no one else', async () => {
    const session = await createSession();
    const read = (token: string) =>
      request(server()).get(`/design/sessions/${session.id}`).set(...bearer(token));
    await read(customer).expect(200);
    await read(manager).expect(200);
    await read(designer).expect(403);
  });

  it('returns 404 for an unknown session', async () => {
    await request(server())
      .get('/design/sessions/00000000-0000-4000-8000-000000000000')
      .set(...bearer(customer))
      .expect(404);
  });
});
