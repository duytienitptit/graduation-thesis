import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/enums.js';
import { IS_PUBLIC, ROLES } from './auth.decorators.js';
import { AuthPort } from './auth.port.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthPort,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const user = scheme === 'Bearer' && token ? await this.auth.verifyToken(token) : null;
    if (!user) throw new UnauthorizedException();

    request.user = user;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (!roles?.length) return true;
    return roles.includes(context.switchToHttp().getRequest().user?.role);
  }
}
