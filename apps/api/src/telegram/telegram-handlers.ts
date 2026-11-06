import { Bot } from 'grammy';
import { LinkResult } from './telegram-link.service.js';

export const MESSAGES = {
  welcome:
    'Chào bạn! Đây là bot nhận việc dành cho designer. Hãy mở link liên kết trong trang designer để nối tài khoản của bạn.',
  linked: 'Đã liên kết tài khoản. Bạn sẽ nhận task mới ở đây.',
  invalidCode: 'Link này đã hết hạn hoặc đã được dùng. Hãy tạo link mới trong trang designer.',
  chatInUse: 'Tài khoản Telegram này đã nối với một designer khác.',
  claimed: 'Bạn đã nhận task này.',
  alreadyTaken: 'Task này đã có người nhận.',
  designerBusy: 'Bạn đang làm một task khác hoặc đang tạm dừng, nên chưa nhận được task này.',
  notLinked: 'Tài khoản Telegram này chưa liên kết với designer nào.',
  takenNotice: 'Task này đã có người nhận.',
  openTask: 'Mở trang task để chat với khách:',
  chatNotice: 'Khách vừa có phản hồi trong task của bạn.',
};

export const CLAIM_PREFIX = 'claim:';

export type ClaimOutcome = 'claimed' | 'already-taken' | 'designer-busy' | 'not-linked';

const CLAIM_REPLIES: Record<ClaimOutcome, string> = {
  claimed: MESSAGES.claimed,
  'already-taken': MESSAGES.alreadyTaken,
  'designer-busy': MESSAGES.designerBusy,
  'not-linked': MESSAGES.notLinked,
};

const LINK_REPLIES: Record<LinkResult, string> = {
  linked: MESSAGES.linked,
  'invalid-code': MESSAGES.invalidCode,
  'chat-in-use': MESSAGES.chatInUse,
};

export interface TelegramActions {
  link(code: string, chatId: string, username?: string): Promise<LinkResult>;
  claim(chatId: string, taskId: string): Promise<ClaimOutcome>;
  taskUrl(taskId: string): string;
}

/** Handlers do not care how updates arrive, so polling can become a webhook later. */
export function registerHandlers(bot: Bot, actions: TelegramActions) {
  bot.chatType('private').command('start', async (ctx) => {
    const code = ctx.match.trim();
    if (!code) return ctx.reply(MESSAGES.welcome);

    const result = await actions.link(code, String(ctx.chat.id), ctx.from.username);
    return ctx.reply(LINK_REPLIES[result]);
  });

  bot.callbackQuery(new RegExp(`^${CLAIM_PREFIX}(.+)$`), async (ctx) => {
    const outcome = await actions.claim(String(ctx.from.id), ctx.match[1]);
    await ctx.answerCallbackQuery({
      text: CLAIM_REPLIES[outcome],
      show_alert: outcome !== 'claimed',
    });
    if (outcome === 'claimed') {
      await ctx.editMessageReplyMarkup();
      await ctx.reply(`${MESSAGES.claimed}\n${MESSAGES.openTask}\n${actions.taskUrl(ctx.match[1])}`);
    }
  });
}
