import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { requireTelegramUser } from '../middleware/telegramAuth';
import { formatMinutes, getFreeSlotsForDate, getSettings, todayInTz } from '../services/schedule';
import { notifyAdmin, notifyClientBookingCancelled, notifyClientBookingConfirmed } from '../bot/notify';

export const bookingRouter = Router();

async function loadActiveLink(token: string) {
  const link = await prisma.accessLink.findUnique({ where: { token }, include: { serviceType: true } });
  if (!link) return { error: 'not_found' as const };
  if (link.status !== 'active') return { error: link.status === 'used' ? ('used' as const) : ('revoked' as const) };
  if (link.expiresAt && link.expiresAt < new Date()) return { error: 'expired' as const };
  return { link };
}

bookingRouter.get('/init', async (req, res) => {
  const token = String(req.query.token ?? '');
  const result = await loadActiveLink(token);
  if ('error' in result) {
    res.status(410).json({ error: result.error });
    return;
  }
  const settings = await getSettings();
  res.json({
    serviceType: result.link.serviceType
      ? { name: result.link.serviceType.name, durationMin: result.link.serviceType.durationMin }
      : null,
    horizonDays: settings.bookingHorizonDays,
    note: result.link.note,
  });
});

bookingRouter.get('/days', async (req, res) => {
  const token = String(req.query.token ?? '');
  const result = await loadActiveLink(token);
  if ('error' in result) {
    res.status(410).json({ error: result.error });
    return;
  }
  const settings = await getSettings();
  const today = todayInTz(settings.timezone);
  const days: { date: string; hasSlots: boolean }[] = [];
  for (let i = 0; i < settings.bookingHorizonDays; i++) {
    const d = today.plus({ days: i });
    const dateISO = d.toFormat('yyyy-MM-dd');
    const slots = await getFreeSlotsForDate(dateISO);
    days.push({ date: dateISO, hasSlots: !!slots && slots.length > 0 });
  }
  res.json({ days });
});

bookingRouter.get('/slots', async (req, res) => {
  const token = String(req.query.token ?? '');
  const date = String(req.query.date ?? '');
  const result = await loadActiveLink(token);
  if ('error' in result) {
    res.status(410).json({ error: result.error });
    return;
  }
  const slots = await getFreeSlotsForDate(date);
  if (slots === null) {
    res.status(400).json({ error: 'invalid_date' });
    return;
  }
  res.json({ slots: slots.map((startMin) => ({ startMin, label: formatMinutes(startMin) })) });
});

const confirmSchema = z.object({
  token: z.string().min(1),
  date: z.string().min(1),
  startMin: z.number().int().nonnegative(),
});

bookingRouter.post('/confirm', requireTelegramUser, async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { token, date, startMin } = parsed.data;

  const result = await loadActiveLink(token);
  if ('error' in result) {
    res.status(410).json({ error: result.error });
    return;
  }
  const link = result.link;

  const freeSlots = await getFreeSlotsForDate(date);
  if (!freeSlots || !freeSlots.includes(startMin)) {
    res.status(409).json({ error: 'slot_unavailable' });
    return;
  }

  const settings = await getSettings();
  const duration = link.serviceType?.durationMin ?? settings.slotMinutes;
  const dayJs = DateTime.fromISO(date, { zone: settings.timezone }).startOf('day').toJSDate();
  const telegramUser = req.telegramUser!;

  try {
    const booking = await prisma.$transaction(async (tx) => {
      // Быстрая проверка для честного 409 без лишней записи; от гонки параллельных
      // запросов на самом деле защищает частичный уникальный индекс в БД (см. миграцию) —
      // он и превращается ниже в P2002, если два запроса проскочили эту проверку одновременно.
      const clash = await tx.booking.findFirst({ where: { date: dayJs, startMin, status: 'confirmed' } });
      if (clash) throw new Error('slot_unavailable');

      const client = await tx.client.upsert({
        where: { telegramId: BigInt(telegramUser.id) },
        update: {
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        },
        create: {
          telegramId: BigInt(telegramUser.id),
          firstName: telegramUser.first_name,
          lastName: telegramUser.last_name,
          username: telegramUser.username,
        },
      });

      const created = await tx.booking.create({
        data: {
          clientId: client.id,
          serviceTypeId: link.serviceTypeId,
          date: dayJs,
          startMin,
          endMin: startMin + duration,
          status: 'confirmed',
        },
      });

      await tx.accessLink.update({
        where: { id: link.id },
        data: { status: 'used', usedAt: new Date(), bookingId: created.id },
      });

      return created;
    });

    await notifyClientBookingConfirmed(
      BigInt(telegramUser.id),
      { date: booking.date, startMin: booking.startMin, serviceTypeName: link.serviceType?.name },
      settings.timezone,
    );
    await notifyAdmin(
      `📥 Новая запись: ${telegramUser.first_name ?? ''} (@${telegramUser.username ?? '—'})\n${DateTime.fromJSDate(booking.date).setZone(settings.timezone).toFormat('dd.MM.yyyy')} в ${formatMinutes(booking.startMin)}`,
    );

    res.json({
      booking: {
        id: booking.id,
        date: date,
        startMin: booking.startMin,
        endMin: booking.endMin,
        serviceTypeName: link.serviceType?.name ?? null,
      },
    });
  } catch (err) {
    const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
    if ((err instanceof Error && err.message === 'slot_unavailable') || isUniqueViolation) {
      res.status(409).json({ error: 'slot_unavailable' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  }
});

bookingRouter.get('/my', requireTelegramUser, async (req, res) => {
  const telegramUser = req.telegramUser!;
  const client = await prisma.client.findUnique({ where: { telegramId: BigInt(telegramUser.id) } });
  if (!client) {
    res.json({ bookings: [] });
    return;
  }
  const bookings = await prisma.booking.findMany({
    where: { clientId: client.id, status: 'confirmed', date: { gte: DateTime.now().startOf('day').toJSDate() } },
    include: { serviceType: true },
    orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
  });
  res.json({
    bookings: bookings.map((b) => ({
      id: b.id,
      date: DateTime.fromJSDate(b.date).toFormat('yyyy-MM-dd'),
      startMin: b.startMin,
      endMin: b.endMin,
      serviceTypeName: b.serviceType?.name ?? null,
    })),
  });
});

bookingRouter.post('/my/:id/cancel', requireTelegramUser, async (req, res) => {
  const id = Number(req.params.id);
  const telegramUser = req.telegramUser!;
  const client = await prisma.client.findUnique({ where: { telegramId: BigInt(telegramUser.id) } });
  const booking = client
    ? await prisma.booking.findFirst({ where: { id, clientId: client.id, status: 'confirmed' }, include: { serviceType: true } })
    : null;
  if (!booking) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  await prisma.booking.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date() } });
  const settings = await getSettings();
  await notifyAdmin(
    `❌ Клиент отменил запись: ${telegramUser.first_name ?? ''} (@${telegramUser.username ?? '—'})\n${DateTime.fromJSDate(booking.date).setZone(settings.timezone).toFormat('dd.MM.yyyy')} в ${formatMinutes(booking.startMin)}`,
  );
  res.json({ ok: true });
});
