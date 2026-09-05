import { Telegraf, Markup } from 'telegraf';
import { customAlphabet } from 'nanoid';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { env } from '../env';
import { prisma } from '../prisma';
import { formatDateLabel, formatMinutes, getFreeSlots, listWorkingDays, TIMEZONE } from '../schedule';

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

function toCompact(dateISO: string) {
  return dateISO.replace(/-/g, '');
}
function fromCompact(compact: string) {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

const DATES_PER_PAGE = 8;

async function loadActiveLink(token: string) {
  const link = await prisma.accessLink.findUnique({ where: { token } });
  if (!link || link.status !== 'active') return null;
  return link;
}

function dateKeyboard(token: string, offset: number) {
  const days = listWorkingDays(offset, DATES_PER_PAGE);
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < days.length; i += 2) {
    const row = days.slice(i, i + 2).map((d) => Markup.button.callback(d.label, `s:${token}:${toCompact(d.date)}`));
    rows.push(row);
  }
  if (days.length === DATES_PER_PAGE) {
    rows.push([Markup.button.callback('▶ Ещё даты', `d:${token}:${offset + DATES_PER_PAGE}`)]);
  }
  return Markup.inlineKeyboard(rows);
}

async function slotKeyboard(token: string, dateISO: string) {
  const slots = await getFreeSlots(dateISO);
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < slots.length; i += 3) {
    const row = slots
      .slice(i, i + 3)
      .map((s) => Markup.button.callback(formatMinutes(s), `b:${token}:${toCompact(dateISO)}:${s}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback('⬅ Другая дата', `d:${token}:0`)]);
  return { slots, keyboard: Markup.inlineKeyboard(rows) };
}

bot.start(async (ctx) => {
  const payload = ctx.startPayload?.trim();

  if (!payload) {
    if (isAdmin(ctx.from.id)) {
      await ctx.reply('Чтобы выдать клиенту ссылку на запись, используйте команду /newlink.');
    } else {
      await ctx.reply('Чтобы записаться на консультацию, получите персональную ссылку у администратора.');
    }
    return;
  }

  const link = await loadActiveLink(payload);
  if (!link) {
    await ctx.reply('Эта ссылка недействительна или уже использована. Обратитесь за новой.');
    return;
  }

  await ctx.reply('Выберите дату консультации:', dateKeyboard(payload, 0));
});

bot.command('newlink', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const token = nanoid();
  await prisma.accessLink.create({ data: { token } });
  await ctx.reply(`Ссылка для клиента:\n${deepLinkForToken(token)}`);
});

bot.action(/^d:([^:]+):(\d+)$/, async (ctx) => {
  const token = ctx.match[1];
  const offset = Number(ctx.match[2]);
  const link = await loadActiveLink(token);
  await ctx.answerCbQuery();
  if (!link) {
    await ctx.editMessageText('Эта ссылка недействительна или уже использована.');
    return;
  }
  await ctx.editMessageText('Выберите дату консультации:', dateKeyboard(token, offset));
});

bot.action(/^s:([^:]+):(\d{8})$/, async (ctx) => {
  const token = ctx.match[1];
  const dateISO = fromCompact(ctx.match[2]);
  const link = await loadActiveLink(token);
  await ctx.answerCbQuery();
  if (!link) {
    await ctx.editMessageText('Эта ссылка недействительна или уже использована.');
    return;
  }
  const { slots, keyboard } = await slotKeyboard(token, dateISO);
  if (slots.length === 0) {
    await ctx.editMessageText(`На ${formatDateLabel(dateISO)} свободного времени не осталось. Выберите другую дату:`, dateKeyboard(token, 0));
    return;
  }
  await ctx.editMessageText(`${formatDateLabel(dateISO)} — выберите время:`, keyboard);
});

bot.action(/^b:([^:]+):(\d{8}):(\d+)$/, async (ctx) => {
  const token = ctx.match[1];
  const dateISO = fromCompact(ctx.match[2]);
  const startMin = Number(ctx.match[3]);
  await ctx.answerCbQuery();

  const link = await loadActiveLink(token);
  if (!link) {
    await ctx.editMessageText('Эта ссылка недействительна или уже использована.');
    return;
  }

  const freeSlots = await getFreeSlots(dateISO);
  if (!freeSlots.includes(startMin)) {
    const { keyboard } = await slotKeyboard(token, dateISO);
    await ctx.editMessageText('Это время уже заняли. Выберите другое:', keyboard);
    return;
  }

  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE }).startOf('day').toJSDate();
  const from = ctx.from;
  const clientName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || String(from.id);

  try {
    await prisma.$transaction([
      prisma.booking.create({
        data: {
          telegramId: BigInt(from.id),
          telegramName: clientName,
          date: day,
          startMin,
          endMin: startMin + 60,
        },
      }),
      prisma.accessLink.update({ where: { id: link.id }, data: { status: 'used', usedAt: new Date() } }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const { keyboard } = await slotKeyboard(token, dateISO);
      await ctx.editMessageText('Это время только что заняли. Выберите другое:', keyboard);
      return;
    }
    console.error('Ошибка создания записи', err);
    await ctx.editMessageText('Не получилось создать запись. Попробуйте ещё раз чуть позже.');
    return;
  }

  await ctx.editMessageText(`✅ Готово! Вы записаны на ${formatDateLabel(dateISO)} в ${formatMinutes(startMin)}.`);

  try {
    await bot.telegram.sendMessage(
      env.ADMIN_TELEGRAM_ID,
      `📥 Новая запись: ${clientName}\n${formatDateLabel(dateISO)} в ${formatMinutes(startMin)}`,
    );
  } catch (err) {
    console.error('Не удалось уведомить админа', err);
  }
});
