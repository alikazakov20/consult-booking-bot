import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { customAlphabet } from 'nanoid';
import { prisma } from '../prisma';
import { requireAdmin } from '../middleware/telegramAuth';
import { getSettings, getWorkingHours } from '../services/schedule';
import { deepLinkForToken } from '../bot/bot';
import { notifyClientBookingCancelled } from '../bot/notify';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 16);

// ---- Расписание ----

adminRouter.get('/schedule', async (_req, res) => {
  const settings = await getSettings();
  const workingHours = await getWorkingHours();
  res.json({ settings, workingHours });
});

const scheduleSchema = z.object({
  settings: z.object({
    slotMinutes: z.number().int().min(5),
    bufferMinutes: z.number().int().min(0),
    timezone: z.string().min(1),
    bookingHorizonDays: z.number().int().min(1).max(365),
  }),
  workingHours: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startMin: z.number().int().min(0).max(1440),
      endMin: z.number().int().min(0).max(1440),
      isActive: z.boolean(),
    }),
  ),
});

adminRouter.put('/schedule', async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
    return;
  }
  const { settings, workingHours } = parsed.data;

  await prisma.scheduleSettings.upsert({ where: { id: 1 }, update: settings, create: { id: 1, ...settings } });
  for (const wh of workingHours) {
    await prisma.workingHours.upsert({
      where: { weekday: wh.weekday },
      update: wh,
      create: wh,
    });
  }
  res.json({ ok: true });
});

// ---- Исключения ----

adminRouter.get('/exceptions', async (_req, res) => {
  const list = await prisma.dateException.findMany({
    where: { date: { gte: DateTime.now().startOf('day').toJSDate() } },
    orderBy: { date: 'asc' },
  });
  res.json({
    exceptions: list.map((e) => ({
      id: e.id,
      date: DateTime.fromJSDate(e.date).toFormat('yyyy-MM-dd'),
      isClosed: e.isClosed,
      startMin: e.startMin,
      endMin: e.endMin,
      note: e.note,
    })),
  });
});

const exceptionSchema = z.object({
  date: z.string().min(1),
  isClosed: z.boolean(),
  startMin: z.number().int().min(0).max(1440).optional().nullable(),
  endMin: z.number().int().min(0).max(1440).optional().nullable(),
  note: z.string().optional().nullable(),
});

adminRouter.post('/exceptions', async (req, res) => {
  const parsed = exceptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { date, isClosed, startMin, endMin, note } = parsed.data;
  const dayJs = DateTime.fromISO(date).startOf('day').toJSDate();
  const created = await prisma.dateException.upsert({
    where: { date: dayJs },
    update: { isClosed, startMin: startMin ?? null, endMin: endMin ?? null, note: note ?? null },
    create: { date: dayJs, isClosed, startMin: startMin ?? null, endMin: endMin ?? null, note: note ?? null },
  });
  res.json({ id: created.id });
});

adminRouter.delete('/exceptions/:id', async (req, res) => {
  await prisma.dateException.delete({ where: { id: Number(req.params.id) } }).catch(() => null);
  res.json({ ok: true });
});

// ---- Записи ----

adminRouter.get('/bookings', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const bookings = await prisma.booking.findMany({
    where: status ? { status } : undefined,
    include: { client: true, serviceType: true },
    orderBy: [{ date: 'desc' }, { startMin: 'asc' }],
    take: 200,
  });
  res.json({
    bookings: bookings.map((b) => ({
      id: b.id,
      date: DateTime.fromJSDate(b.date).toFormat('yyyy-MM-dd'),
      startMin: b.startMin,
      endMin: b.endMin,
      status: b.status,
      serviceTypeName: b.serviceType?.name ?? null,
      client: {
        firstName: b.client.firstName,
        lastName: b.client.lastName,
        username: b.client.username,
      },
    })),
  });
});

adminRouter.post('/bookings/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);
  const booking = await prisma.booking.findUnique({ where: { id }, include: { client: true, serviceType: true } });
  if (!booking || booking.status !== 'confirmed') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  await prisma.booking.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date() } });
  const settings = await getSettings();
  await notifyClientBookingCancelled(booking.client.telegramId, { date: booking.date, startMin: booking.startMin }, settings.timezone);
  res.json({ ok: true });
});

// ---- Услуги ----

adminRouter.get('/service-types', async (_req, res) => {
  const list = await prisma.serviceType.findMany({ orderBy: { id: 'asc' } });
  res.json({ serviceTypes: list });
});

const serviceTypeSchema = z.object({ name: z.string().min(1), durationMin: z.number().int().min(5) });

adminRouter.post('/service-types', async (req, res) => {
  const parsed = serviceTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const created = await prisma.serviceType.create({ data: parsed.data });
  res.json({ serviceType: created });
});

adminRouter.patch('/service-types/:id', async (req, res) => {
  const id = Number(req.params.id);
  const parsed = serviceTypeSchema.partial().extend({ isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const updated = await prisma.serviceType.update({ where: { id }, data: parsed.data });
  res.json({ serviceType: updated });
});

// ---- Ссылки доступа ----

adminRouter.get('/links', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const links = await prisma.accessLink.findMany({
    where: status ? { status } : undefined,
    include: { serviceType: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({
    links: links.map((l) => ({
      id: l.id,
      token: l.token,
      deepLink: deepLinkForToken(l.token),
      status: l.status,
      note: l.note,
      serviceTypeName: l.serviceType?.name ?? null,
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      usedAt: l.usedAt,
    })),
  });
});

const createLinkSchema = z.object({
  serviceTypeId: z.number().int().optional().nullable(),
  note: z.string().optional().nullable(),
  expiresInDays: z.number().int().min(1).max(365).optional().nullable(),
});

adminRouter.post('/links', async (req, res) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const { serviceTypeId, note, expiresInDays } = parsed.data;
  const token = nanoid();
  const created = await prisma.accessLink.create({
    data: {
      token,
      serviceTypeId: serviceTypeId ?? undefined,
      note: note ?? undefined,
      expiresAt: expiresInDays ? DateTime.now().plus({ days: expiresInDays }).toJSDate() : undefined,
    },
  });
  res.json({ id: created.id, token, deepLink: deepLinkForToken(token) });
});

adminRouter.post('/links/:id/revoke', async (req, res) => {
  const id = Number(req.params.id);
  const link = await prisma.accessLink.findUnique({ where: { id } });
  if (!link || link.status !== 'active') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  await prisma.accessLink.update({ where: { id }, data: { status: 'revoked' } });
  res.json({ ok: true });
});
