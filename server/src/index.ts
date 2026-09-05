import path from 'path';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { DateTime } from 'luxon';
import { env } from './env';
import { prisma } from './prisma';
import { bot, setBotUsername } from './bot/bot';
import { bookingRouter } from './routes/booking';
import { adminRouter } from './routes/admin';
import { getSettings } from './services/schedule';
import { sendReminder } from './bot/notify';

async function main() {
  const me = await bot.telegram.getMe();
  setBotUsername(me.username);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  app.use('/api/booking', bookingRouter);
  app.use('/api/admin', adminRouter);

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  if (env.BOT_MODE === 'webhook') {
    const webhookPath = `/telegram/webhook/${env.WEBHOOK_SECRET}`;
    app.use(bot.webhookCallback(webhookPath));
    await bot.telegram.setWebhook(`${env.WEBAPP_URL}${webhookPath}`);
  } else {
    await bot.telegram.deleteWebhook().catch(() => null);
    bot.launch();
  }

  app.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT} (bot mode: ${env.BOT_MODE})`);
  });

  startReminderJob();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

function startReminderJob() {
  cron.schedule('* * * * *', async () => {
    try {
      const settings = await getSettings();
      const from = DateTime.now();
      const to = from.plus({ hours: env.REMINDER_HOURS_BEFORE });

      const candidates = await prisma.booking.findMany({
        where: { status: 'confirmed', reminderSentAt: null },
        include: { client: true, serviceType: true },
      });

      for (const b of candidates) {
        const start = DateTime.fromJSDate(b.date).setZone(settings.timezone).plus({ minutes: b.startMin });
        if (start >= from && start <= to) {
          await sendReminder(b.client.telegramId, { date: b.date, startMin: b.startMin, serviceTypeName: b.serviceType?.name }, settings.timezone);
          await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
        }
      }
    } catch (err) {
      console.error('Ошибка джобы напоминаний', err);
    }
  });
}

main().catch((err) => {
  console.error('Не удалось запустить сервер', err);
  process.exit(1);
});
