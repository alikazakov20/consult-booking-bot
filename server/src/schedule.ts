import { DateTime } from 'luxon';
import { prisma } from './prisma';

// Единственное место, где меняется расписание. Зафиксировано по просьбе — без админ-панели.
export const TIMEZONE = 'Europe/Moscow';
export const WORK_WEEKDAYS = [1, 2, 3, 4, 5]; // luxon: 1=понедельник ... 7=воскресенье
export const WORK_START_MIN = 9 * 60;
export const WORK_END_MIN = 18 * 60;
export const SLOT_MINUTES = 60;
export const BOOKING_HORIZON_DAYS = 60;

export interface WorkingDay {
  date: string; // YYYY-MM-DD
  label: string; // "Пн 08.09"
}

const WEEKDAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function listWorkingDays(offset: number, count: number): WorkingDay[] {
  const today = DateTime.now().setZone(TIMEZONE).startOf('day');
  const result: WorkingDay[] = [];
  let cursor = today;
  let skipped = 0;

  while (result.length < offset + count) {
    if (WORK_WEEKDAYS.includes(cursor.weekday)) {
      if (skipped >= offset) {
        result.push({
          date: cursor.toFormat('yyyy-MM-dd'),
          label: `${WEEKDAY_SHORT[cursor.weekday]} ${cursor.toFormat('dd.MM')}`,
        });
      }
      skipped++;
    }
    cursor = cursor.plus({ days: 1 });
    if (cursor.diff(today, 'days').days > BOOKING_HORIZON_DAYS) break;
  }

  return result.slice(offset, offset + count);
}

export function isWithinHorizon(dateISO: string): boolean {
  const today = DateTime.now().setZone(TIMEZONE).startOf('day');
  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE }).startOf('day');
  return day >= today && day.diff(today, 'days').days <= BOOKING_HORIZON_DAYS && WORK_WEEKDAYS.includes(day.weekday);
}

export async function getFreeSlots(dateISO: string): Promise<number[]> {
  if (!isWithinHorizon(dateISO)) return [];

  const day = DateTime.fromISO(dateISO, { zone: TIMEZONE }).startOf('day');
  const today = DateTime.now().setZone(TIMEZONE).startOf('day');
  const isToday = day.equals(today);
  const nowMinutes = DateTime.now().setZone(TIMEZONE).diff(today, 'minutes').minutes;

  const slots: number[] = [];
  for (let t = WORK_START_MIN; t + SLOT_MINUTES <= WORK_END_MIN; t += SLOT_MINUTES) {
    if (!isToday || t > nowMinutes) slots.push(t);
  }

  const booked = await prisma.booking.findMany({ where: { date: day.toJSDate() }, select: { startMin: true } });
  const bookedSet = new Set(booked.map((b) => b.startMin));
  return slots.filter((s) => !bookedSet.has(s));
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDateLabel(dateISO: string): string {
  return DateTime.fromISO(dateISO, { zone: TIMEZONE }).setLocale('ru').toFormat("d MMMM");
}
