import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Bot } from 'grammy';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DesignersService } from '../task/designers.service.js';
import { TasksService } from '../task/tasks.service.js';
import { TelegramBotService } from './telegram-bot.service.js';
import {
  CLAIM_PREFIX,
  ClaimOutcome,
  MESSAGES,
  registerHandlers,
} from './telegram-handlers.js';
import { TelegramLinkService } from './telegram-link.service.js';

/** A bot that records its calls instead of talking to Telegram. */
function offlineBot() {
  const bot = new Bot('offline', {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    } as never,
  });
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  return { bot, calls };
}

const message = (text: string) => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: 'private' as const, first_name: 'A' },
    from: { id: 42, is_bot: false, first_name: 'A' },
    text,
    entities: [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0].length }],
  },
});

describe('Telegram handlers', () => {
  const offlineActions = (result: 'linked' | 'invalid-code' | 'chat-in-use') => {
    const link = jest.fn(async (_code: string, _chat: string, _name?: string) => result);
    const claim = jest.fn(async (_chat: string, _task: string) => 'claimed' as const);
    return { link, claim };
  };

  it('greets on a plain /start, without linking', async () => {
    const { bot, calls } = offlineBot();
    const actions = offlineActions('linked');
    registerHandlers(bot, actions);
    await bot.handleUpdate(message('/start'));
    expect(calls[0].payload).toMatchObject({ chat_id: 42, text: MESSAGES.welcome });
    expect(actions.link).not.toHaveBeenCalled();
  });

  it.each([
    ['linked', MESSAGES.linked],
    ['invalid-code', MESSAGES.invalidCode],
    ['chat-in-use', MESSAGES.chatInUse],
  ] as const)('answers /start with a code when the result is %s', async (result, text) => {
    const { bot, calls } = offlineBot();
    const actions = offlineActions(result);
    registerHandlers(bot, actions);
    await bot.handleUpdate(message('/start abc123'));
    expect(actions.link).toHaveBeenCalledWith('abc123', '42', undefined);
    expect(calls[0].payload).toMatchObject({ text });
  });
});

describe('the Take task button', () => {
  const press = (data: string) => ({
    update_id: 2,
    callback_query: {
      id: 'q1',
      chat_instance: 'c',
      from: { id: 42, is_bot: false, first_name: 'A' },
      data,
      message: {
        message_id: 9,
        date: 0,
        chat: { id: 42, type: 'private' as const, first_name: 'A' },
      },
    },
  });

  async function pressWith(outcome: ClaimOutcome) {
    const { bot, calls } = offlineBot();
    const claim = jest.fn(async (_chat: string, _task: string) => outcome);
    registerHandlers(bot, { link: async () => 'linked', claim });
    await bot.handleUpdate(press(`${CLAIM_PREFIX}task-1`));
    return { calls, claim };
  }

  it('claims, confirms and removes the button', async () => {
    const { calls, claim } = await pressWith('claimed');
    expect(claim).toHaveBeenCalledWith('42', 'task-1');
    expect(calls.map((call) => call.method)).toEqual([
      'answerCallbackQuery',
      'editMessageReplyMarkup',
      'sendMessage',
    ]);
    expect(calls[0].payload).toMatchObject({ text: MESSAGES.claimed });
  });

  it.each([
    ['already-taken', MESSAGES.alreadyTaken],
    ['designer-busy', MESSAGES.designerBusy],
    ['not-linked', MESSAGES.notLinked],
  ] as const)('shows the reason for %s and keeps the message', async (outcome, text) => {
    const { calls } = await pressWith(outcome);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('answerCallbackQuery');
    expect(calls[0].payload).toMatchObject({ text, show_alert: true });
  });
});

describe('TelegramBotService', () => {
  it('stays off unless enabled, and needs no token then', async () => {
    const service = new TelegramBotService(
      new ConfigService({ TELEGRAM_ENABLED: 'false' }),
      {} as TelegramLinkService,
      {} as DesignersService,
      {} as TasksService,
    );
    expect(service.enabled).toBe(false);
    expect(service.username).toBeNull();
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe('linking a designer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let links: TelegramLinkService;
  let now = new Date('2026-11-09T03:00:00Z');
  let username: string | null = 'test_bot';
  const userIds: string[] = [];

  const server = () => app.getHttpServer();

  async function designer() {
    const email = `${crypto.randomUUID()}@link.test`;
    const user = await prisma.user.create({
      data: { email, name: 'D', role: 'DESIGNER', designer: { create: {} } },
      include: { designer: true },
    });
    userIds.push(user.id);
    const res = await request(server()).post('/auth/dev-login').send({ email }).expect(200);
    return { ...user.designer!, token: res.body.token as string };
  }

  const chat = () => String(Math.floor(Math.random() * 1e12));

  const profile = (id: string) =>
    prisma.designerProfile.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramBotService)
      .useValue({
        get username() {
          return username;
        },
      })
      .overrideProvider(Clock)
      .useValue({ now: () => now })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    links = app.get(TelegramLinkService);
  });

  afterEach(() => {
    now = new Date('2026-11-09T03:00:00Z');
    username = 'test_bot';
  });

  afterAll(async () => {
    const where = { designer: { userId: { in: userIds } } };
    await prisma.telegramLinkCode.deleteMany({ where });
    await prisma.designerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('gives a designer a t.me link, and shows them as linked after using it', async () => {
    const d = await designer();
    const res = await request(server())
      .post('/designers/me/telegram-link')
      .set('Authorization', `Bearer ${d.token}`)
      .expect(201);
    const url = new URL(res.body.url);
    expect(`${url.origin}${url.pathname}`).toBe('https://t.me/test_bot');

    const id = chat();
    expect(await links.link(url.searchParams.get('start')!, id, 'dtest')).toBe('linked');
    expect(await profile(d.id)).toMatchObject({ telegramChatId: id, telegramUsername: 'dtest' });

    const me = await request(server())
      .get('/designers/me')
      .set('Authorization', `Bearer ${d.token}`)
      .expect(200);
    expect(me.body).toEqual({
      state: 'FREE',
      telegramLinked: true,
      telegramUsername: 'dtest',
    });
  });

  it('is for designers, and needs the bot running', async () => {
    const d = await designer();
    await request(server()).post('/designers/me/telegram-link').expect(401);
    username = null;
    await request(server())
      .post('/designers/me/telegram-link')
      .set('Authorization', `Bearer ${d.token}`)
      .expect(503);
  });

  it('works once only', async () => {
    const d = await designer();
    const { code } = await links.createCode(d.id);
    expect(await links.link(code, chat())).toBe('linked');
    expect(await links.link(code, chat())).toBe('invalid-code');
  });

  it('lets one of two parallel uses win', async () => {
    const d = await designer();
    const { code } = await links.createCode(d.id);
    const results = await Promise.all([links.link(code, chat()), links.link(code, chat())]);
    expect(results.sort()).toEqual(['invalid-code', 'linked']);
  });

  it('expires after 15 minutes', async () => {
    const d = await designer();
    const { code } = await links.createCode(d.id);
    now = new Date(now.getTime() + 15 * 60 * 1000);
    expect(await links.link(code, chat())).toBe('invalid-code');
    expect((await profile(d.id)).telegramChatId).toBeNull();
  });

  it('rejects an unknown code', async () => {
    expect(await links.link('nonsense', chat())).toBe('invalid-code');
  });

  it('keeps only the latest code', async () => {
    const d = await designer();
    const first = await links.createCode(d.id);
    const second = await links.createCode(d.id);
    expect(await links.link(first.code, chat())).toBe('invalid-code');
    expect(await links.link(second.code, chat())).toBe('linked');
  });

  it('will not put one Telegram account on two designers', async () => {
    const first = await designer();
    const second = await designer();
    const id = chat();
    await links.link((await links.createCode(first.id)).code, id);
    expect(await links.link((await links.createCode(second.id)).code, id)).toBe('chat-in-use');
    expect((await profile(second.id)).telegramChatId).toBeNull();
  });

  it('lets a designer link again from the same chat', async () => {
    const d = await designer();
    const id = chat();
    await links.link((await links.createCode(d.id)).code, id);
    expect(await links.link((await links.createCode(d.id)).code, id)).toBe('linked');
  });
});
