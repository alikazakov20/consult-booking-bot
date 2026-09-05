import crypto from 'crypto';

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Проверяет подпись initData по алгоритму Telegram WebApp
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Возвращает null при любой невалидности — вызывающий код не должен доверять данным иначе.
 */
export function verifyTelegramInitData(initData: string, botToken: string): VerifiedInitData | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs: string[] = [];
  const keys = [...params.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    pairs.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedBuf = Buffer.from(computedHash, 'hex');
  const givenBuf = Buffer.from(hash, 'hex');
  if (computedBuf.length !== givenBuf.length || !crypto.timingSafeEqual(computedBuf, givenBuf)) {
    return null;
  }

  const authDate = Number(params.get('auth_date') ?? '0');
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return { user, authDate };
}
