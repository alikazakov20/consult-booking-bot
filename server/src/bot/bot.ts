import { Telegraf, Markup, Context } from 'telegraf';
import { customAlphabet } from 'nanoid';
import { env } from '../env';
import { prisma } from '../prisma';

export const bot = new Telegraf(env.BOT_TOKEN);

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 16);

let botUsername = '';

export function setBotUsername(username: string) {
  botUsername = username;
}

export function deepLinkForToken(token: string) {
  return `https://t.me/${botUsername}?start=${token}`;
}

function isAdmin(telegramId: number) {
  return telegramId === env.ADMIN_TELEGRAM_ID;
}

async function replyWithAdminMenu(ctx: Context) {
  await ctx.reply(
    'Админ-панель бота записи.',
    Markup.inlineKeyboard([
      Markup.button.webApp('⚙️ Открыть админку', `${env.WEBAPP_URL}/admin`),
    ]),
  );
}

bot.start(async (ctx) => {
  const payload = ctx.startPayload?.trim();
  const telegramId = ctx.from.id;

  if (payload) {
    const link = await prisma.accessLink.findUnique({ where: { token: payload } });
    const now = new Date();
    if (!link || link.status !== 'active' || (link.expiresAt && link.expiresAt < now)) {
      await ctx.reply('Эта ссылка на запись недействительна или уже использована. Обратитесь к администратору за новой ссылкой.');
      return;
    }
    await ctx.reply(
      'Добро пожаловать! Нажмите кнопку ниже, чтобы выбрать удобную дату и время консультации.',
      Markup.inlineKeyboard([
        Markup.button.webApp('📅 Записаться', `${env.WEBAPP_URL}/booking?token=${payload}`),
      ]),
    );
    return;
  }

  if (isAdmin(telegramId)) {
    await replyWithAdminMenu(ctx);
    return;
  }

  const client = await prisma.client.findUnique({ where: { telegramId: BigInt(telegramId) } });
  const hasBookings = client
    ? await prisma.booking.count({ where: { clientId: client.id, status: 'confirmed', date: { gte: new Date() } } })
    : 0;

  if (hasBookings > 0) {
    await ctx.reply(
      'Ваши записи:',
      Markup.inlineKeyboard([Markup.button.webApp('🗓 Мои записи', `${env.WEBAPP_URL}/my`)]),
    );
  } else {
    await ctx.reply('У вас нет активной ссылки на запись. Обратитесь к администратору, чтобы получить её.');
  }
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await replyWithAdminMenu(ctx);
});

bot.command('newlink', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const serviceType = await prisma.serviceType.findFirst({ where: { isActive: true } });
  const token = nanoid();
  await prisma.accessLink.create({
    data: { token, serviceTypeId: serviceType?.id, note: 'создано командой /newlink' },
  });
  await ctx.reply(`Новая ссылка для клиента:\n${deepLinkForToken(token)}`);
});
