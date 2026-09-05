import { DateTime } from 'luxon';
import { prisma } from '../prisma';

export interface Settings {
  slotMinutes: number;
  bufferMinutes: number;
  timezone: string;
  bookingHorizonDays: number;
}

export async function getSettings(): Promise<Settings> {
  const row = await prisma.scheduleSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  return row;
}

export async function getWorkingHours() {
  return prisma.workingHours.findMany({ orderBy: { weekday: 'asc' } });
}

export function todayInTz(timezone: string) {
  return DateTime.now().setZone(timezone).startOf('day');
}

export function parseDateInTz(dateISO: string, timezone: string) {
  return DateTime.fromISO(dateISO, { zone: timezone }).startOf('day');
}

/**
 * Возвращает список свободных startMin (минут от полуночи) для даты dateISO ("YYYY-MM-DD"),
 * либо null, если дата вне горизонта записи или в прошлом.
 */
export async function getFreeSlotsForDate(dateISO: string): Promise<number[] | null> {
  const settings = await getSettings();
  const day = parseDateInTz(dateISO, settings.timezone);
  const today = todayInTz(settings.timezone);
  const horizon = today.plus({ days: settings.bookingHorizonDays });

  if (day < today || day > horizon) return null;

  const exception = await prisma.dateException.findUnique({ where: { date: day.toJSDate() } });

  let startMin: number | null = null;
  let endMin: number | null = null;

  if (exception) {
    if (exception.isClosed) return [];
    startMin = exception.startMin ?? null;
    endMin = exception.endMin ?? null;
    if (startMin == null || endMin == null) return [];
  } else {
    const weekday = day.weekday % 7; // luxon: 1=Monday..7=Sunday -> приводим к 0=Sunday..6=Saturday
    const wh = await prisma.workingHours.findUnique({ where: { weekday } });
    if (!wh || !wh.isActive) return [];
    startMin = wh.startMin;
    endMin = wh.endMin;
  }

  const step = settings.slotMinutes + settings.bufferMinutes;
  const slots: number[] = [];
  for (let t = startMin; t + settings.slotMinutes <= endMin; t += step) {
    slots.push(t);
  }

  const isToday = day.equals(today);
  const nowMinutes = isToday ? DateTime.now().setZone(settings.timezone).diff(today, 'minutes').minutes : -1;

  const booked = await prisma.booking.findMany({
    where: { date: day.toJSDate(), status: 'confirmed' },
    select: { startMin: true },
  });
  const bookedSet = new Set(booked.map((b) => b.startMin));

  return slots.filter((s) => (!isToday || s > nowMinutes) && !bookedSet.has(s));
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, '0');
  const m = (min % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
