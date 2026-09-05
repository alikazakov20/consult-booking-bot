import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN обязателен'),
  ADMIN_TELEGRAM_ID: z.coerce.number().int(),
  WEBAPP_URL: z.string().url(),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  WEBHOOK_SECRET: z.string().default('change-me'),
  PORT: z.coerce.number().int().default(3000),
  REMINDER_HOURS_BEFORE: z.coerce.number().min(0).default(3),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Некорректные переменные окружения:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
