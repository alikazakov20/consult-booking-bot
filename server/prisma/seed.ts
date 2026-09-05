import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.scheduleSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, slotMinutes: 60, bufferMinutes: 0, timezone: 'Europe/Moscow', bookingHorizonDays: 30 },
  });

  // Пн-Пт 9:00-18:00, Сб-Вс выключены
  const defaults = [
    { weekday: 0, startMin: 0, endMin: 0, isActive: false },
    { weekday: 1, startMin: 9 * 60, endMin: 18 * 60, isActive: true },
    { weekday: 2, startMin: 9 * 60, endMin: 18 * 60, isActive: true },
    { weekday: 3, startMin: 9 * 60, endMin: 18 * 60, isActive: true },
    { weekday: 4, startMin: 9 * 60, endMin: 18 * 60, isActive: true },
    { weekday: 5, startMin: 9 * 60, endMin: 18 * 60, isActive: true },
    { weekday: 6, startMin: 0, endMin: 0, isActive: false },
  ];
  for (const wh of defaults) {
    await prisma.workingHours.upsert({
      where: { weekday: wh.weekday },
      update: {},
      create: wh,
    });
  }

  const existing = await prisma.serviceType.findFirst();
  if (!existing) {
    await prisma.serviceType.create({
      data: { name: 'Консультация', durationMin: 60, isActive: true },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
