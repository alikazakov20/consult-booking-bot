import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN обязателен'),
  ADMIN_TELEGRAM_ID: z.coerce.number().int(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Некорректные переменные окружения:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
