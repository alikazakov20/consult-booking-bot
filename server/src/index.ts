import { bot, setBotUsername } from './bot/bot';

async function main() {
  const me = await bot.telegram.getMe();
  setBotUsername(me.username);

  await bot.telegram.deleteWebhook().catch(() => null);
  bot.launch();
  console.log(`Бот @${me.username} запущен (long polling)`);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Не удалось запустить бота', err);
  process.exit(1);
});
