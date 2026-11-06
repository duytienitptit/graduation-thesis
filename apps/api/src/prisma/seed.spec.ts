import { afterAll, describe, expect, it } from '@jest/globals';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient } from '../generated/prisma/client.js';

config({ path: resolve(process.cwd(), '../../.env'), quiet: true });

describe('seeded users', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  afterAll(() => prisma.$disconnect());

  it('has one customer, two designers with profiles and one manager', async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: '@example.test' } },
      orderBy: { role: 'asc' },
    });
    expect(users.map((user) => user.role)).toEqual([
      'CUSTOMER',
      'DESIGNER',
      'DESIGNER',
      'MANAGER',
    ]);
    const profiles = await prisma.designerProfile.count({
      where: { user: { email: { endsWith: '@example.test' } } },
    });
    expect(profiles).toBe(2);
  });
});
