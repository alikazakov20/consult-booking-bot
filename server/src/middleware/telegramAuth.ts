import { RequestHandler } from 'express';
import { env } from '../env';
import { TelegramWebAppUser, verifyTelegramInitData } from '../telegram/verifyInitData';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      telegramUser?: TelegramWebAppUser;
    }
  }
}

export const requireTelegramUser: RequestHandler = (req, res, next) => {
  const initData = req.header('x-telegram-init-data') ?? '';
  const verified = verifyTelegramInitData(initData, env.BOT_TOKEN);
  if (!verified) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.telegramUser = verified.user;
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireTelegramUser(req, res, () => {
    if (req.telegramUser?.id !== env.ADMIN_TELEGRAM_ID) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  });
};
