import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthPort, AuthUser } from './auth.port.js';

const USER_FIELDS = { id: true, email: true, name: true, role: true } as const;

/** Stand-in login: pick a seeded account, no password. Development only. */
@Injectable()
export class DevAuthService extends AuthPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    super();
  }

  listUsers(): Promise<AuthUser[]> {
    return this.prisma.user.findMany({ select: USER_FIELDS, orderBy: { role: 'asc' } });
  }

  async login(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: USER_FIELDS });
    if (!user) return null;
    return { token: await this.jwt.signAsync({ sub: user.id }), user };
  }

  async verifyToken(token: string): Promise<AuthUser | null> {
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      return await this.prisma.user.findUnique({ where: { id: sub }, select: USER_FIELDS });
    } catch {
      return null;
    }
  }
}
