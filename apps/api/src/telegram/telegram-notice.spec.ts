import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';
import { AppModule } from '../app.module.js';
import { FilesPort } from '../integrations/files/files.port.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueuedTelegramSender } from '../task/queued-telegram-sender.js';
import { MAX_CAPTION, taskSummary } from './task-summary.js';
import { TelegramBotService } from './telegram-bot.service.js';
import { CLAIM_PREFIX, MESSAGES } from './telegram-handlers.js';
import { TelegramNoticeProcessor } from './telegram-notice.processor.js';

describe('Telegram notices', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let processor: TelegramNoticeProcessor;
  const sent: { chatId: string; photo: Buffer; options: { caption: string } }[] = [];
  const replaced: { chatId: string; messageId: number; text: string }[] = [];
  const texts: { chatId: string; text: string }[] = [];
  let failure: Error | null = null;
  const userIds: string[] = [];

  async function notice(status: 'WAITING' | 'ASSIGNED' = 'WAITING', chatId: string | null = '99') {
    const tag = crypto.randomUUID();
    const customer = await prisma.user.create({
      data: { email: `${tag}c@notice.test`, name: 'C', role: 'CUSTOMER' },
    });
    const designer = await prisma.user.create({
      data: {
        email: `${tag}d@notice.test`,
        name: 'D',
        role: 'DESIGNER',
        designer: { create: { telegramChatId: chatId && `${chatId}${tag}` } },
      },
      include: { designer: true },
    });
    userIds.push(customer.id, designer.id);

    const session = await prisma.designSession.create({
      data: {
        customerId: customer.id,
        status: 'DESIGNER',
        specSnapshot: {
          product: { id: 'p', name: 'Áo đá bóng', shirtType: 'FOOTBALL' },
          colour: { id: 'red', name: 'Đỏ', hex: '#f00' },
          material: { id: 'mesh', name: 'Thun mè' },
          size: 'L',
          quantity: 12,
        },
        answers: { team_name: 'FC Sài Gòn', collar: 'polo' },
      },
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
        requirement: 'Làm logo đẹp hơn',
        referenceVersionId: version.id,
        status,
      },
    });
    return prisma.taskNotice.create({
      data: { taskId: task.id, designerId: designer.designer!.id, dayKey: '2026-11-09' },
    });
  }

  const run = (noticeId: string, attemptsMade = 0) =>
    processor.process({ name: 'send', data: { noticeId }, attemptsMade } as Job<{
      noticeId: string;
    }>);

  const markTaken = (noticeId: string) =>
    processor.process({ name: 'mark-taken', data: { noticeId }, attemptsMade: 0 } as Job<{
      noticeId: string;
    }>);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramBotService)
      .useValue({
        username: 'test_bot',
        replaceNotice: async (chatId: string, messageId: number, text: string) => {
          if (failure) throw failure;
          replaced.push({ chatId, messageId, text });
        },
        sendText: async (chatId: string, text: string) => {
          texts.push({ chatId, text });
        },
        taskUrl: (taskId: string) => `http://web/designer/tasks/${taskId}`,
        sendPhoto: async (chatId: string, photo: Buffer, options: { caption: string }) => {
          if (failure) throw failure;
          sent.push({ chatId, photo, options });
          return { message_id: 777 };
        },
      })
      .overrideProvider(FilesPort)
      .useValue({
        readImage: async () => ({ mimeType: 'image/png', data: Buffer.from('pixels') }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    processor = app.get(TelegramNoticeProcessor);
  });

  afterEach(() => {
    sent.length = 0;
    replaced.length = 0;
    texts.length = 0;
    failure = null;
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

  it('sends the task with a take button, and stores the message id', async () => {
    const row = await notice();
    await run(row.id);

    expect(sent[0].photo.toString()).toBe('pixels');
    expect(sent[0].options.caption).toContain('Áo đá bóng');
    expect(sent[0].options.caption).toContain('Làm logo đẹp hơn');
    expect(sent[0].options.caption).toContain('FC Sài Gòn');
    const markup = sent[0].options as unknown as {
      reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] };
    };
    const button = markup.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe('Nhận task');
    expect(button.callback_data).toBe(`${CLAIM_PREFIX}${row.taskId}`);
    expect(button.callback_data.length).toBeLessThanOrEqual(64);

    const stored = await prisma.taskNotice.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.externalId).toBe('777');
  });

  it('does not send twice when a job runs again', async () => {
    const row = await notice();
    await run(row.id);
    await run(row.id);
    expect(sent).toHaveLength(1);
  });

  it('skips a task taken while the notice waited', async () => {
    const row = await notice('ASSIGNED');
    await run(row.id);
    expect(sent).toEqual([]);
    expect(await prisma.taskNotice.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it('changes a sent message to say the task is taken', async () => {
    const row = await notice();
    await run(row.id);
    await markTaken(row.id);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ messageId: 777, text: MESSAGES.takenNotice });
  });

  it('changes a sent message to say the customer cancelled', async () => {
    const created = await notice();
    await prisma.taskNotice.update({ where: { id: created.id }, data: { externalId: '55' } });
    await processor.process({
      name: 'mark-taken',
      data: { noticeId: created.id, reason: 'cancelled' },
      attemptsMade: 0,
    } as Job);
    expect(replaced.at(-1)).toMatchObject({ messageId: 55, text: MESSAGES.cancelledNotice });
  });

  it('has nothing to change when the message was never sent', async () => {
    const row = await notice();
    await markTaken(row.id);
    expect(replaced).toEqual([]);
  });

  it('lets a failed change be retried', async () => {
    const row = await notice();
    await run(row.id);
    failure = new Error('Telegram down');
    await expect(markTaken(row.id)).rejects.toThrow('Telegram down');
  });

  it('tells the task\'s designer about a customer message, with a link to the task', async () => {
    const { taskId, designerId } = await notice('ASSIGNED');
    const designer = await prisma.designerProfile.findUniqueOrThrow({ where: { id: designerId } });
    await prisma.task.update({ where: { id: taskId }, data: { designerId } });

    await processor.process({ name: 'chat-notice', data: { taskId } } as Job);

    expect(texts).toEqual([
      {
        chatId: designer.telegramChatId,
        text: `${MESSAGES.chatNotice}\nhttp://web/designer/tasks/${taskId}`,
      },
    ]);
  });

  it('skips the notice once the task is no longer open', async () => {
    const { taskId } = await notice('WAITING');
    await processor.process({ name: 'chat-notice', data: { taskId } } as Job);
    expect(texts).toEqual([]);
  });

  it('keeps the notice for a retry, and removes it after the last attempt', async () => {
    const row = await notice();
    failure = new Error('Telegram down');
    await expect(run(row.id, 0)).rejects.toThrow('Telegram down');
    expect(await prisma.taskNotice.findUnique({ where: { id: row.id } })).not.toBeNull();

    await expect(run(row.id, 4)).rejects.toThrow('Telegram down');
    expect(await prisma.taskNotice.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

describe('QueuedTelegramSender', () => {
  it('reaches only linked designers, and queues with retries', async () => {
    const jobs: unknown[][] = [];
    const sender = new QueuedTelegramSender({
      add: async (...args: unknown[]) => jobs.push(args),
    } as never);

    expect(sender.canReach({ id: 'a', telegramChatId: null })).toBe(false);
    expect(sender.canReach({ id: 'a', telegramChatId: '1' })).toBe(true);

    await sender.send({ id: 'a', telegramChatId: '1' }, { id: 't', requirement: 'x' }, 'notice-1');
    expect(jobs[0][1]).toEqual({ noticeId: 'notice-1' });
    expect(jobs[0][2]).toMatchObject({ attempts: 5 });

    const bulk: { name: string; data: unknown }[][] = [];
    const taken = new QueuedTelegramSender({
      addBulk: async (items: { name: string; data: unknown }[]) => bulk.push(items),
    } as never);
    await taken.markTaken({ id: 't', requirement: 'x' }, [{ id: 'n1' }, { id: 'n2' }]);
    expect(bulk[0].map((item) => item.data)).toEqual([
      { noticeId: 'n1', reason: 'taken' },
      { noticeId: 'n2', reason: 'taken' },
    ]);
    expect(bulk[0][0].name).toBe('mark-taken');
  });
});

describe('taskSummary', () => {
  const specs = {
    product: { id: 'p', name: 'Áo đá bóng', shirtType: 'FOOTBALL' },
    colour: { id: 'red', name: 'Đỏ', hex: '#f00' },
    material: { id: 'mesh', name: 'Thun mè' },
    size: 'L',
    quantity: 12,
  } as const;

  it('uses the specs, the requirement, and answers with their labels', () => {
    const text = taskSummary(
      specs,
      { team_name: 'FC Sài Gòn', collar: 'polo', logo_upload: ['a'], has_logo: 'yes' },
      'Làm logo đẹp hơn',
    );
    expect(text).toContain('Task mới: Áo đá bóng');
    expect(text).toContain('Màu áo: Đỏ');
    expect(text).toContain('Size L, số lượng 12');
    expect(text).toContain('Làm logo đẹp hơn');
    expect(text).toContain('Tên đội là gì? FC Sài Gòn');
    expect(text).toContain('Bạn muốn kiểu cổ nào? Cổ polo');
    expect(text).toContain('Tải logo lên 1 ảnh tải lên');
  });

  it('stays within the caption limit', () => {
    const text = taskSummary(specs, {}, 'x'.repeat(2000));
    expect(text.length).toBeLessThanOrEqual(MAX_CAPTION);
    expect(text).toContain('Xem đầy đủ sau khi nhận task.');
  });
});
