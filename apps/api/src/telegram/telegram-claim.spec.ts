import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Bot } from 'grammy';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NoticeTask, TaskNoticeSender } from '../task/task-notice-sender.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { CLAIM_PREFIX, MESSAGES, registerHandlers } from './telegram-handlers.js';

/**
 * Stands in for the check with two real Telegram accounts: real handlers, claim and
 * PostgreSQL, with only the calls to Telegram's servers replaced.
 */
class RecordingSender extends TaskNoticeSender {
  taken: { taskId: string; ids: string[] }[] = [];

  canReach() {
    return false;
  }

  async send() {
    return null;
  }

  async markTaken(task: NoticeTask, notices: { id: string }[]) {
    this.taken.push({ taskId: task.id, ids: notices.map((notice) => notice.id) });
  }

  async messageWaiting() {}
}

describe('two linked designers press Take task', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: TelegramBotService;
  const sender = new RecordingSender();
  const userIds: string[] = [];

  function offlineBot() {
    const bot = new Bot('offline', {
      botInfo: { id: 1, is_bot: true, first_name: 'T', username: 't_bot' } as never,
    });
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: true } as never;
    });
    registerHandlers(bot, {
      link: async () => 'linked',
      claim: (chatId, taskId) => service.claim(chatId, taskId),
      taskUrl: (taskId) => `http://web/${taskId}`,
    });
    return { bot, calls };
  }

  const press = (chatId: number, taskId: string) => ({
    update_id: chatId,
    callback_query: {
      id: `q${chatId}`,
      chat_instance: 'c',
      from: { id: chatId, is_bot: false, first_name: 'D' },
      data: `${CLAIM_PREFIX}${taskId}`,
      message: {
        message_id: 9,
        date: 0,
        chat: { id: chatId, type: 'private' as const, first_name: 'D' },
      },
    },
  });

  async function designer() {
    const chatId = Math.floor(Math.random() * 1e12) + 1;
    const user = await prisma.user.create({
      data: {
        email: `${crypto.randomUUID()}@claim.test`,
        name: 'D',
        role: 'DESIGNER',
        designer: { create: { telegramChatId: String(chatId) } },
      },
      include: { designer: true },
    });
    userIds.push(user.id);
    return { ...user.designer!, chatId };
  }

  async function waitingTask(designerIds: string[]) {
    const tag = crypto.randomUUID();
    const customer = await prisma.user.create({
      data: { email: `${tag}@claim.test`, name: 'C', role: 'CUSTOMER' },
    });
    userIds.push(customer.id);
    const session = await prisma.designSession.create({
      data: { customerId: customer.id, status: 'DESIGNER', specSnapshot: {} },
    });
    const file = await prisma.fileObject.create({
      data: {
        ownerId: customer.id,
        storageKey: `test/${tag}.png`,
        mimeType: 'image/png',
        size: 1,
        purpose: 'AI_IMAGE',
        status: 'READY',
      },
    });
    const version = await prisma.designVersion.create({
      data: { sessionId: session.id, fileId: file.id, source: 'AI' },
    });
    const task = await prisma.task.create({
      data: {
        sessionId: session.id,
        customerId: customer.id,
        requirement: 'x',
        referenceVersionId: version.id,
      },
    });
    await prisma.taskNotice.createMany({
      data: designerIds.map((designerId) => ({
        taskId: task.id,
        designerId,
        dayKey: '2026-11-09',
        externalId: '5',
      })),
    });
    return task;
  }

  const alertFor = (calls: { method: string; payload: Record<string, unknown> }[]) =>
    calls.find((call) => call.method === 'answerCallbackQuery')?.payload.text;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TaskNoticeSender)
      .useValue(sender)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(TelegramBotService);
  });

  afterEach(() => {
    sender.taken = [];
  });

  afterAll(async () => {
    const customer = { customerId: { in: userIds } };
    await prisma.taskNotice.deleteMany({ where: { task: customer } });
    await prisma.task.deleteMany({ where: customer });
    await prisma.designVersion.deleteMany({ where: { session: customer } });
    await prisma.designSession.deleteMany({ where: customer });
    await prisma.fileObject.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.designerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it('the first press wins, the second is told, and the other message updates', async () => {
    const first = await designer();
    const second = await designer();
    const task = await waitingTask([first.id, second.id]);
    const one = offlineBot();
    const two = offlineBot();

    await one.bot.handleUpdate(press(first.chatId, task.id));
    await two.bot.handleUpdate(press(second.chatId, task.id));

    expect(alertFor(one.calls)).toBe(MESSAGES.claimed);
    expect(alertFor(two.calls)).toBe(MESSAGES.alreadyTaken);
    expect(one.calls.map((call) => call.method)).toContain('editMessageReplyMarkup');
    expect(two.calls.map((call) => call.method)).not.toContain('editMessageReplyMarkup');

    const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored).toMatchObject({ status: 'ASSIGNED', designerId: first.id });

    const notice = await prisma.taskNotice.findFirstOrThrow({
      where: { taskId: task.id, designerId: second.id },
    });
    expect(sender.taken).toEqual([{ taskId: task.id, ids: [notice.id] }]);
  });

  it('gives one winner when both press at the same moment', async () => {
    const first = await designer();
    const second = await designer();
    const task = await waitingTask([first.id, second.id]);
    const one = offlineBot();
    const two = offlineBot();

    await Promise.all([
      one.bot.handleUpdate(press(first.chatId, task.id)),
      two.bot.handleUpdate(press(second.chatId, task.id)),
    ]);

    expect([alertFor(one.calls), alertFor(two.calls)].sort()).toEqual(
      [MESSAGES.alreadyTaken, MESSAGES.claimed].sort(),
    );
  });

  it('turns away a Telegram account that is not linked', async () => {
    const task = await waitingTask([]);
    const { bot, calls } = offlineBot();
    await bot.handleUpdate(press(987654321, task.id));
    expect(alertFor(calls)).toBe(MESSAGES.notLinked);
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.status).toBe('WAITING');
  });
});
