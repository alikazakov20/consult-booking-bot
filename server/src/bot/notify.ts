import { DateTime } from 'luxon';
import { bot } from './bot';
import { env } from '../env';
import { formatMinutes } from '../services/schedule';

function formatDate(date: Date, timezone: string) {
  return DateTime.fromJSDate(date).setZone(timezone).toFormat('dd.MM.yyyy');
}

interface BookingSummary {
  date: Date;
  startMin: number;
  serviceTypeName?: string | null;
}

export async function notifyClientBookingConfirmed(telegramId: bigint, b: BookingSummary, timezone: string) {
  const text = `✅ Запись подтверждена!\n${b.serviceTypeName ? `Услуга: ${b.serviceTypeName}\n` : ''}Дата: ${formatDate(b.date, timezone)}\nВремя: ${formatMinutes(b.startMin)}`;
  await safeSend(Number(telegramId), text);
}

export async function notifyClientBookingCancelled(telegramId: bigint, b: BookingSummary, timezone: string) {
  const text = `❌ Запись отменена.\nДата: ${formatDate(b.date, timezone)}\nВремя: ${formatMinutes(b.startMin)}`;
  await safeSend(Number(telegramId), text);
}

export async function notifyAdmin(text: string) {
  await safeSend(env.ADMIN_TELEGRAM_ID, text);
}

export async function sendReminder(telegramId: bigint, b: BookingSummary, timezone: string) {
  const text = `⏰ Напоминание: скоро консультация${b.serviceTypeName ? ` (${b.serviceTypeName})` : ''}.\nДата: ${formatDate(b.date, timezone)}\nВремя: ${formatMinutes(b.startMin)}`;
  await safeSend(Number(telegramId), text);
}

async function safeSend(chatId: number, text: string) {
  try {
    await bot.telegram.sendMessage(chatId, text);
  } catch (err) {
    console.error('Не удалось отправить сообщение в Telegram', chatId, err);
  }
}
