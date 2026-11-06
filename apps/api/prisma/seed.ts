import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const users = [
  { email: 'khach@example.test', name: 'Khách Mẫu', role: Role.CUSTOMER },
  { email: 'designer@example.test', name: 'Designer Mẫu', role: Role.DESIGNER },
  { email: 'quanli@example.test', name: 'Quản Lí Mẫu', role: Role.MANAGER },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  for (const user of users) {
    await prisma.user.upsert({ where: { email: user.email }, update: user, create: user });
  }
  console.log(`Seeded ${users.length} users`);
} finally {
  await prisma.$disconnect();
}
