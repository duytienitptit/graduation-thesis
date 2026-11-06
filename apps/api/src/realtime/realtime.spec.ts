import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { RealtimeAdapter } from './realtime.adapter.js';
import { RealtimeGateway } from './realtime.gateway.js';

describe('realtime gateway', () => {
  let app: INestApplication;
  let url: string;
  let sockets: Socket[] = [];

  const session = async (email: string) =>
    (await request(app.getHttpServer()).post('/auth/dev-login').send({ email }).expect(200)).body;

  function open(auth: object) {
    const socket = io(url, { auth, reconnection: false, transports: ['websocket'] });
    sockets.push(socket);
    return socket;
  }

  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new RealtimeAdapter(app));
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterEach(() => {
    sockets.forEach((socket) => socket.disconnect());
    sockets = [];
  });

  afterAll(() => app.close());

  it('refuses a connection with no token or a bad token', async () => {
    await expect(connected(open({}))).rejects.toThrow('unauthorized');
    await expect(connected(open({ token: 'nonsense' }))).rejects.toThrow('unauthorized');
  });

  it('delivers to every tab of that user and to nobody else', async () => {
    const customer = await session('khach@example.test');
    const designer = await session('designer@example.test');
    const tabOne = open({ token: customer.token });
    const tabTwo = open({ token: customer.token });
    const other = open({ token: designer.token });
    await Promise.all([tabOne, tabTwo, other].map(connected));

    const received: string[] = [];
    other.on('ping-test', () => received.push('other'));
    const both = Promise.all(
      [tabOne, tabTwo].map(
        (tab) => new Promise((resolve) => tab.once('ping-test', resolve)),
      ),
    );

    app.get(RealtimeGateway).emitToUser(customer.user.id, 'ping-test', { hello: 'xin chào' });

    await expect(both).resolves.toEqual([{ hello: 'xin chào' }, { hello: 'xin chào' }]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([]);
  });

  it('delivers an event sent the moment a client connects', async () => {
    const customer = await session('khach@example.test');
    const gateway = app.get(RealtimeGateway);
    const socket = open({ token: customer.token });
    const message = new Promise((resolve) => socket.once('ping-test', resolve));
    socket.once('connect', () => gateway.emitToUser(customer.user.id, 'ping-test', 1));
    await expect(message).resolves.toBe(1);
  });
});
