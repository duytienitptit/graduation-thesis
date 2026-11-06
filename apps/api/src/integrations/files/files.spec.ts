import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MAX_FILE_SIZE } from './files.port.js';

// Runs against the real MinIO and PostgreSQL from docker-compose.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest of a test image'),
]);

describe('files', () => {
  let app: INestApplication;
  let customer: string;
  let designer: string;
  let manager: string;
  const created: string[] = [];

  const server = () => app.getHttpServer();
  const bearer = (token: string) => ['Authorization', `Bearer ${token}`] as const;
  const login = async (email: string) =>
    (await request(server()).post('/auth/dev-login').send({ email }).expect(200)).body.token;

  async function ticket(body: Buffer, mimeType = 'image/png') {
    const res = await request(server())
      .post('/files/upload-url')
      .set(...bearer(customer))
      .send({ mimeType, size: body.length, purpose: 'REFERENCE' })
      .expect(201);
    created.push(res.body.fileId);
    return res.body;
  }

  const put = (t: { uploadUrl: string; headers: Record<string, string> }, body: Buffer) =>
    fetch(t.uploadUrl, { method: 'PUT', headers: t.headers, body: new Uint8Array(body) });

  async function uploaded(body = PNG) {
    const t = await ticket(body);
    expect((await put(t, body)).status).toBe(200);
    await request(server())
      .post(`/files/${t.fileId}/complete`)
      .set(...bearer(customer))
      .expect(204);
    return t.fileId as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    customer = await login('khach@example.test');
    designer = await login('designer@example.test');
    manager = await login('quanli@example.test');
  });

  afterAll(async () => {
    await app.get(PrismaService).fileObject.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  it('uploads a file and gives back the same bytes', async () => {
    const id = await uploaded();
    const res = await request(server())
      .get(`/files/${id}/download-url`)
      .set(...bearer(customer))
      .expect(200);
    const download = await fetch(res.body.url);
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('needs login', async () => {
    await request(server()).post('/files/upload-url').send({}).expect(401);
  });

  it('refuses other types, oversized files and client AI images', async () => {
    const send = (body: object) =>
      request(server()).post('/files/upload-url').set(...bearer(customer)).send(body);
    const valid = { mimeType: 'image/png', size: 100, purpose: 'REFERENCE' };
    await send({ ...valid, mimeType: 'application/pdf' }).expect(400);
    await send({ ...valid, size: MAX_FILE_SIZE + 1 }).expect(400);
    await send({ ...valid, purpose: 'AI_IMAGE' }).expect(400);
  });

  it('takes a real PDF in chat, and nowhere else', async () => {
    const pdf = Buffer.from('%PDF-1.7 rest of a test document');
    const send = (purpose: string) =>
      request(server())
        .post('/files/upload-url')
        .set(...bearer(customer))
        .send({ mimeType: 'application/pdf', size: pdf.length, purpose });
    await send('FINAL_DESIGN').expect(400);

    const res = await send('CHAT').expect(201);
    created.push(res.body.fileId);
    expect((await put(res.body, pdf)).status).toBe(200);
    await request(server())
      .post(`/files/${res.body.fileId}/complete`)
      .set(...bearer(customer))
      .expect(204);
  });

  it('rejects a file that claims to be a PDF but is not', async () => {
    const fake = Buffer.from('this is plain text, not a PDF');
    const res = await request(server())
      .post('/files/upload-url')
      .set(...bearer(customer))
      .send({ mimeType: 'application/pdf', size: fake.length, purpose: 'CHAT' })
      .expect(201);
    created.push(res.body.fileId);
    await put(res.body, fake);
    await request(server())
      .post(`/files/${res.body.fileId}/complete`)
      .set(...bearer(customer))
      .expect(400);
  });

  it('accepts exactly 10 MB', async () => {
    const body = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_SIZE - PNG.length)]);
    await uploaded(body);
  });

  it('rejects an upload larger than declared', async () => {
    const t = await ticket(PNG);
    const res = await put(t, Buffer.concat([PNG, Buffer.from('extra bytes')]));
    expect(res.ok).toBe(false);
  });

  it('rejects and removes a file that is not really an image', async () => {
    const fake = Buffer.from('this is plain text, not a PNG');
    const t = await ticket(fake);
    await put(t, fake);
    await request(server())
      .post(`/files/${t.fileId}/complete`)
      .set(...bearer(customer))
      .expect(400);
    await request(server())
      .get(`/files/${t.fileId}/download-url`)
      .set(...bearer(customer))
      .expect(404);
  });

  it('will not complete or serve a file that was never uploaded', async () => {
    const t = await ticket(PNG);
    await request(server())
      .post(`/files/${t.fileId}/complete`)
      .set(...bearer(customer))
      .expect(409);
    await request(server())
      .get(`/files/${t.fileId}/download-url`)
      .set(...bearer(customer))
      .expect(409);
  });

  it('lets only the owner and managers download', async () => {
    const id = await uploaded();
    await request(server()).get(`/files/${id}/download-url`).set(...bearer(designer)).expect(403);
    await request(server()).get(`/files/${id}/download-url`).set(...bearer(manager)).expect(200);
  });

  it('lets only the owner complete an upload', async () => {
    const t = await ticket(PNG);
    await put(t, PNG);
    await request(server())
      .post(`/files/${t.fileId}/complete`)
      .set(...bearer(designer))
      .expect(403);
  });
});
